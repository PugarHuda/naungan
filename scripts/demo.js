// End-to-end pitch demo: npx hardhat run scripts/demo.js
// Two agencies serve households in Banda Aceh. They dedup privately, enroll anonymously, the flood
// oracle posts the real GloFAS reading, then replays the real November 2025 Krueng Aceh flood from
// reanalysis (labelled REPLAY on-chain), households claim via a gas relayer, and the public totals
// are rebuilt from chain events alone.
//
// Against a deployed network (feeds the web dashboard live):
//   npx hardhat run scripts/demo.js --network localhost      (STEP_DELAY=3000 for video pacing)
//   npx hardhat run scripts/demo.js --network baseSepolia    (needs Circle testnet USDC: faucet.circle.com)
// For the production flow (real agencies, QR cards, phone claims) use scripts/coordinator.js,
// scripts/agency.js, scripts/oracle.js, scripts/relayer.js and web/claim.html.
const fs = require("fs")
const path = require("path")
const { ethers, run, network } = require("hardhat")
const { Identity, Group, generateProof } = require("@semaphore-protocol/core")
const { Agency, privateDedup } = require("../lib/psi")
const hazard = require("../lib/hazard")

const LOCAL = ["hardhat", "localhost"].includes(network.name)
const PER_HOUSEHOLD = process.env.AMOUNT ?? (LOCAL ? "50" : "2")
const SITE = { name: "Krueng Aceh flood · Banda Aceh", hazard: "flood", source: "GloFAS v4 river discharge via Open-Meteo", lat: 5.55, lon: 95.32, returnPeriod: 5, leadDays: 10, unit: "% of ensemble members above the return-period flood" }
const TRIGGER = 60 // % of ensemble members; IFRC Uganda's GloFAS EAP acts at 60-70%
const REPLAY_DATE = "2025-11-20" // window covers the 23 Nov 2025 peak of the Sumatra floods

const pause = () => new Promise((r) => setTimeout(r, Number(process.env.STEP_DELAY || 0)))
const say = async (s) => (await pause(), console.log(`\n▶ ${s}`))
const send = async (txPromise) => (await txPromise).wait()

async function contracts() {
    if (network.name === "hardhat") {
        const { semaphore } = await run("deploy:semaphore", { logs: false })
        const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy()
        const naungan = await (await ethers.getContractFactory("Naungan")).deploy(await semaphore.getAddress(), await usdc.getAddress())
        return { usdc, naungan }
    }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "deployment.json")))
    return { usdc: await ethers.getContractAt("MockUSDC", d.usdc), naungan: await ethers.getContractAt("Naungan", d.naungan) }
}

async function main() {
    // ponytail: on a testnet with one key, every role falls back to that key.
    const s = await ethers.getSigners()
    const [coordinator, oracle, unhcrSigner, zakatSigner, donor, relayer] = [0, 1, 2, 3, 4, 5].map((i) => s[i] ?? s[0])
    const { usdc, naungan } = await contracts()
    const dec = await usdc.decimals()
    const amount = ethers.parseUnits(PER_HOUSEHOLD, dec)

    await say(`Coordinator creates program: ${PER_HOUSEHOLD} USDC/household, triggers at ≥${TRIGGER}% GloFAS probability of a 1-in-5-year flood`)
    const startBlock = await ethers.provider.getBlockNumber()
    const now = (await ethers.provider.getBlock("latest")).timestamp
    const created = await send(naungan.createProgram([oracle.address], 1, amount, TRIGGER, 14 * 86400, now + 180 * 86400, JSON.stringify(SITE)))
    const pid = created.logs.map((l) => naungan.interface.parseLog(l)).find((e) => e?.name === "ProgramCreated").args.programId // not programCount(): public RPCs can serve it stale
    await send(naungan.addAgency(pid, unhcrSigner.address))
    if (zakatSigner.address !== unhcrSigner.address) await send(naungan.addAgency(pid, zakatSigner.address))

    const unhcrList = [
        { name: "Fatima Begum", birthYear: 1990, village: "Kamp Lhokseumawe" },
        { name: "Nur Kayas", birthYear: 1985, village: "Kamp Pidie" },
        { name: "Abdul Karim", birthYear: 1979, village: "Kamp Pidie" }
    ]
    const zakatList = [
        { name: "Begum, Fatimah", birthYear: 1990, village: "kamp lhokseumawe" },
        { name: "Mohammed Rafiq", birthYear: 2001, village: "Kamp Aceh Timur" },
        { name: "Abdul Karim", birthYear: 1980, village: "Kamp Pidie" }
    ]

    await say("Private dedup (PSI): zakat agency checks its list against UNHCR's without either seeing the other")
    const dups = privateDedup(new Agency(zakatList), new Agency(unhcrList))
    console.log(`  zakat agency learns: ${dups.size} of its ${zakatList.length} households already served → skip them`)
    const zakatFresh = zakatList.filter((_, i) => !dups.has(i))

    const wallets = [...unhcrList, ...zakatFresh].map((r) => ({ label: r.name, id: new Identity() }))
    const group = new Group(wallets.map((w) => w.id.commitment))

    await say("Agencies enroll anonymous commitments only")
    await send(naungan.connect(unhcrSigner).enroll(pid, wallets.slice(0, unhcrList.length).map((w) => w.id.commitment)))
    await pause()
    await send(naungan.connect(zakatSigner).enroll(pid, wallets.slice(unhcrList.length).map((w) => w.id.commitment)))

    const total = amount * BigInt(wallets.length)
    await say(`Donor funds the pool with ${ethers.formatUnits(total, dec)} USDC`)
    if (LOCAL) await send(usdc.mint(donor.address, total))
    const have = await usdc.balanceOf(donor.address)
    if (have < total) throw new Error(`donor ${donor.address} has ${ethers.formatUnits(have, dec)} USDC, needs ${ethers.formatUnits(total, dec)}: get Circle testnet USDC at faucet.circle.com`)
    await send(usdc.connect(donor).approve(await naungan.getAddress(), total))
    await send(naungan.connect(donor).fund(pid, total))

    await say("Oracle posts today's real GloFAS ensemble forecast for Krueng Aceh")
    const live = await hazard.assess(SITE)
    console.log(`  P(flood) = ${live.probability}% · ${live.evidence}`)
    await send(naungan.connect(oracle).reportIndex(pid, live.probability, live.evidence))
    if (live.probability < TRIGGER) {
        await pause()
        await say(`No flood forecast today. Replaying the real 23 Nov 2025 flood from GloFAS reanalysis (window from ${REPLAY_DATE})`)
        const past = await hazard.replay({ ...SITE, date: REPLAY_DATE })
        console.log(`  P(flood) = ${past.probability}% · ${past.evidence}`)
        await send(naungan.connect(oracle).reportIndex(pid, past.probability, past.evidence))
    }
    if ((await naungan.programs(pid)).claimDeadline === 0n) return console.log("  trigger not reached: claims stay closed")

    await say("Households claim with ZK proofs; relayer pays gas; each payout goes to a fresh address")
    for (const w of wallets) {
        const payout = ethers.Wallet.createRandom().address
        const proof = await generateProof(w.id, group, BigInt(payout), pid)
        await send(naungan.connect(relayer).claim(pid, proof))
        console.log(`  ✓ ${w.label.padEnd(16)} → ${payout.slice(0, 10)}… (chain sees only a nullifier)`)
        await pause()
    }

    await say("Fatima tries to claim twice")
    const again = await generateProof(wallets[0].id, group, BigInt(relayer.address), pid)
    await send(naungan.connect(relayer).claim(pid, again)).catch(() => console.log("  ✗ rejected: nullifier already used"))

    await say("PUBLIC DASHBOARD (rebuilt from on-chain events only)")
    // ponytail: public RPCs cap eth_getLogs at 200 blocks, so scan in chunks
    const head = await ethers.provider.getBlockNumber()
    const ev = async (name) => {
        const out = []
        for (let b = startBlock; b <= head; b += 200) out.push(...(await naungan.queryFilter(naungan.filters[name](pid), b, Math.min(b + 199, head))))
        return out
    }
    const enrolled = (await ev("Enrolled")).reduce((n, e) => n + e.args.households, 0n)
    const funded = (await ev("Funded")).reduce((n, e) => n + e.args.amount, 0n)
    const claims = (await ev("Claimed")).length
    console.table({
        "Agencies": (await ev("AgencyAdded")).length,
        "Duplicates avoided (PSI, off-chain)": dups.size,
        "Households enrolled": Number(enrolled),
        "Unique households paid": claims,
        "Funded (USDC)": ethers.formatUnits(funded, dec),
        "Disbursed (USDC)": ethers.formatUnits(amount * BigInt(claims), dec),
        "Names / IDs on-chain": 0
    })
}

// ponytail: explicit exit, snarkjs worker threads otherwise keep the process alive.
main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })

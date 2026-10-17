// End-to-end pitch demo: npx hardhat run scripts/demo.js
// Two agencies serve Rohingya households in Aceh. They dedup privately, enroll anonymously,
// a flood forecast triggers payouts before the peak, households claim via a gas relayer,
// and the public dashboard is rebuilt from chain events alone (no names anywhere).
//
// Against a deployed network (feeds the web dashboard live):
//   npx hardhat run scripts/demo.js --network localhost      (STEP_DELAY=3000 for video pacing)
const fs = require("fs")
const path = require("path")
const { ethers, run, network } = require("hardhat")
const { Identity, Group, generateProof } = require("@semaphore-protocol/core")
const { Agency, privateDedup } = require("../lib/psi")

const USDC = (n) => BigInt(n) * 10n ** 6n
const pause = () => new Promise((r) => setTimeout(r, Number(process.env.STEP_DELAY || 0)))
const say = async (s) => {
    await pause()
    console.log(`\n▶ ${s}`)
}
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

    await say("Coordinator creates program: 50 USDC/household, triggers at forecast rainfall >= 120 mm")
    const startBlock = await ethers.provider.getBlockNumber()
    await send(naungan.createProgram(oracle.address, USDC(50), 120, 7 * 24 * 3600))
    const pid = await naungan.programCount()
    await send(naungan.addAgency(pid, unhcrSigner.address))
    await send(naungan.addAgency(pid, zakatSigner.address))

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

    // Each household gets a Semaphore identity (held in a Telegram/WhatsApp bot wallet or a QR card).
    const wallets = [...unhcrList, ...zakatFresh].map((r) => ({ label: r.name, id: new Identity() }))
    const group = new Group(wallets.map((w) => w.id.commitment))

    await say("Agencies enroll anonymous commitments only")
    await send(naungan.connect(unhcrSigner).enroll(pid, wallets.slice(0, unhcrList.length).map((w) => w.id.commitment)))
    await pause()
    await send(naungan.connect(zakatSigner).enroll(pid, wallets.slice(unhcrList.length).map((w) => w.id.commitment)))

    await say("Donor funds the pool")
    await send(usdc.mint(donor.address, USDC(1000)))
    await send(usdc.connect(donor).approve(await naungan.getAddress(), USDC(1000)))
    await send(naungan.connect(donor).fund(pid, USDC(250)))

    await say("Oracle (BMKG forecast feed): 80 mm → no trigger; 145 mm → claims open BEFORE the flood peaks")
    await send(naungan.connect(oracle).reportIndex(pid, 80))
    await pause()
    await send(naungan.connect(oracle).reportIndex(pid, 145))

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
    const enrolled = (await ev("Enrolled")).reduce((s, e) => s + e.args.households, 0n)
    const funded = (await ev("Funded")).reduce((s, e) => s + e.args.amount, 0n)
    const claims = (await ev("Claimed")).length
    console.table({
        "Agencies": (await ev("AgencyAdded")).length,
        "Duplicates avoided (PSI, off-chain)": dups.size,
        "Households enrolled": Number(enrolled),
        "Unique households paid": claims,
        "Funded (USDC)": Number(funded / 10n ** 6n),
        "Disbursed (USDC)": claims * 50,
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

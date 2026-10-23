#!/usr/bin/env node
// A program's payouts as a hypercert (lib/hypercert.mjs): 100M units = the USDC that reached households, one allowlist
// fraction per donor, pro rata to their gifts. Minted on Hypercerts' own HypercertMinter; web/hypercerts.json records
// it so the donor statement can offer each donor their fraction.
//
// Metadata and allowlist are static files on this site (web/public/hypercerts/), which Hypercerts' indexer fetches over
// https like an IPFS gateway; their sha256 is kept in web/hypercerts.json, so a changed file is detectable. (Hypercerts'
// own IPFS upload, /v2/metadata, answered "fetch failed" on staging and production when this was written.)
// Two steps, because the indexer reads the files as soon as the claim is minted:
//
//   node scripts/hypercert.js --program 1 --prepare   snapshot the payouts, write the files (then deploy the site)
//   node scripts/hypercert.js --program 1 --mint      check the live files match, then create the claim on-chain
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { parseArgs } = require("util")
const { ethers } = require("ethers")
const { connect, logs, programMeta } = require("../lib/chain")
const hc = require("../lib/hypercert.mjs")

const ROOT = path.join(__dirname, "..")
const FILE = path.join(ROOT, "web", "hypercerts.json")
const { values: a } = parseArgs({ options: { program: { type: "string" }, prepare: { type: "boolean" }, mint: { type: "boolean" }, base: { type: "string", default: "https://naungan.vercel.app" } } })
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex")

async function prepare({ d, provider, naungan }, pid, list) {
    // Everything at one block, so the gifts, the pool and the claims belong together.
    const block = await provider.getBlockNumber()
    const p = await naungan.programs(pid, { blockTag: block })
    if (p.claims === 0n) throw new Error(`program #${pid} has paid nobody yet`)
    if (list.some((x) => x.chainId === d.chainId && x.contract === d.naungan && x.programId === pid && x.claims === Number(p.claims)))
        throw new Error(`program #${pid}: these ${p.claims} payouts already have a hypercert entry in web/hypercerts.json`)
    const from = d.fromBlock ?? 0
    const [funded, reports, claimed] = await Promise.all([
        logs(naungan, naungan.filters.Funded(pid), from, block),
        logs(naungan, naungan.filters.IndexReported(pid), from, block),
        logs(naungan, naungan.filters.Claimed(pid), from, block)
    ])
    if (claimed.length !== Number(p.claims)) throw new Error(`found ${claimed.length} Claimed events, the contract counts ${p.claims}: indexer behind, retry`)
    const trigger = reports.find((r) => r.args.triggered)
    if (!trigger) throw new Error("no triggering report found")
    const time = async (e) => (await provider.getBlock(e.blockNumber)).timestamp

    const entries = hc.shares(funded.map((e) => ({ donor: e.args.donor, amount: e.args.amount })), { funded: p.funded, claims: p.claims, amountPerHousehold: p.amountPerHousehold })
    const tree = hc.tree(entries)
    const meta = await programMeta(naungan, pid)
    const paid = p.claims * p.amountPerHousehold
    const name = `${d.chainId}-${pid}-${block}`
    const treeJson = JSON.stringify(tree.dump())
    const metadata = {
        ...hc.metadata({
            programId: pid, name: meta.name ?? `Program ${pid}`, hazard: meta.hazard ?? "hazard", evidence: trigger.args.evidence,
            households: Number(p.claims), paid, from: await time(trigger), to: await time(claimed.at(-1)), deadline: Number(p.claimDeadline),
            donors: entries.map((e) => ethers.getAddress(e.address)), contract: d.naungan, chainId: d.chainId, block, base: a.base,
            exercise: d.chainId !== 8453 || /^REPLAY/.test(trigger.args.evidence)
        }),
        allowList: `${a.base}/hypercerts/${name}-allowlist.json`
    }
    const metaJson = JSON.stringify(metadata)
    const dir = path.join(ROOT, "web", "public", "hypercerts")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.json`), metaJson)
    fs.writeFileSync(path.join(dir, `${name}-allowlist.json`), treeJson)
    list.push({ chainId: d.chainId, contract: d.naungan, programId: pid, claims: Number(p.claims), block, paid: paid.toString(), units: hc.UNITS.toString(), minter: hc.MINTER[d.chainId], uri: `${a.base}/hypercerts/${name}.json`, sha256: sha(metaJson), allowListSha256: sha(treeJson), root: tree.root, claimID: null, tx: null })
    console.log(`program #${pid} at block ${block}: ${p.claims} households, ${ethers.formatUnits(paid, 6)} USDC, ${entries.length} donor(s), root ${tree.root}`)
    for (const e of entries) console.log(`  ${e.address} ${e.units} units (${ethers.formatUnits(e.paid, 6)} USDC)`)
    console.log(`wrote web/public/hypercerts/${name}.json and -allowlist.json: deploy the site, then run --mint`)
}

async function mint({ d, signer, wallet }, x) {
    // The indexer reads the live files: refuse unless they are byte for byte what was prepared.
    for (const [url, want] of [[x.uri, x.sha256], [x.uri.replace(/\.json$/, "-allowlist.json"), x.allowListSha256]]) {
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok || sha(await res.text()) !== want) throw new Error(`${url} is not live yet or differs from the prepared file (${res.status}): deploy first`)
    }
    // Hypercerts' own validator for the metadata schema. It cannot fetch the allowlist (its server reaches no URL, not
    // even GitHub, when this was written), so the tree is checked here: 100M units, and the root being minted.
    const meta = await (await fetch(x.uri, { cache: "no-store" })).json()
    const { allowList, ...schema } = meta
    const v = await (await fetch(`${hc.API[d.chainId]}/v2/metadata/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ metadata: schema }) })).json()
    if (!v.valid) throw new Error(`Hypercerts' validator refused it: ${JSON.stringify(v).slice(0, 400)}`)
    const t = hc.loadTree(await (await fetch(allowList, { cache: "no-store" })).text())
    if (t.root !== x.root || [...t.entries()].reduce((s, [, [, u]]) => s + BigInt(u), 0n) !== BigInt(x.units)) throw new Error("the live allowlist is not the prepared tree of 100M units")
    const minter = new ethers.Contract(x.minter, hc.ABI, signer)
    const tx = await minter.createAllowlist(wallet.address, BigInt(x.units), x.root, x.uri, hc.ALLOW_ALL)
    const rc = await tx.wait()
    const stored = rc.logs.map((l) => { try { return minter.interface.parseLog(l) } catch { return null } }).find((l) => l?.name === "ClaimStored")
    if (!stored) throw new Error(`no ClaimStored in ${tx.hash}`)
    x.claimID = stored.args.claimID.toString()
    x.creator = wallet.address
    x.tx = tx.hash
    console.log(`hypercert ${x.claimID} · ${d.explorer}/tx/${tx.hash}\n${hc.APP[d.chainId]}/hypercerts/${d.chainId}-${x.minter}-${x.claimID}`)
}

;(async () => {
    const pid = Number(a.program)
    if (!Number.isInteger(pid) || pid < 1 || a.prepare === a.mint) throw new Error("usage: --program N --prepare | --mint")
    const ctx = await connect()
    if (!hc.MINTER[ctx.d.chainId]) throw new Error(`no HypercertMinter known on chain ${ctx.d.chainId}`)
    const list = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : []
    if (a.prepare) await prepare(ctx, pid, list)
    else {
        const x = list.find((y) => y.chainId === ctx.d.chainId && y.contract === ctx.d.naungan && y.programId === pid && !y.claimID)
        if (!x) throw new Error(`nothing prepared for program #${pid}`)
        await mint(ctx, x)
    }
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + "\n")
})().catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
})

#!/usr/bin/env node
// Independent payout audits on EAS (lib/eas.js). Anyone can run these with their own key; the auditor's
// address, not ours, signs the result.
//
//   node scripts/eas.js register                     register the audit schema once per chain (idempotent)
//   node scripts/eas.js audit --program 2            re-verify every payout (lib/audit.js), then attest the result
//   node scripts/eas.js audit --program 2 --dry-run  verify and print, send nothing
//   node scripts/eas.js list  --program 2            audits other people published for the program
const { parseArgs } = require("util")
const { ethers } = require("ethers")
const { connect, logs, explain } = require("../lib/chain")
const { auditClaims, groupRoot } = require("../lib/audit")
const eas = require("../lib/eas")

const { values: a, positionals: [cmd] } = parseArgs({ allowPositionals: true, options: { program: { type: "string" }, "dry-run": { type: "boolean" } } })

/** Everything lib/audit.js needs, read at one block so the counts and the group belong together. */
async function collect({ naungan, provider, d }, pid) {
    const atBlock = await provider.getBlockNumber()
    const [members, p] = await Promise.all([naungan.members(pid, { blockTag: atBlock }), naungan.programs(pid, { blockTag: atBlock })])
    const events = await logs(naungan, naungan.filters.Claimed(pid), d.fromBlock ?? 0, atBlock)
    if (events.length !== Number(p.claims)) throw new Error(`found ${events.length} Claimed events but the contract counts ${p.claims}: the indexer is behind, retry in a minute`)
    const claims = await Promise.all(events.map(async (e) => ({ nullifier: e.args.nullifier, payout: e.args.payout, tx: await provider.getTransaction(e.transactionHash) })))
    const res = await auditClaims({ programId: pid, members: members.map(String), claims, contract: d.naungan })
    return { atBlock, members: members.length, res, root: groupRoot(members.map(String)) ?? 0n }
}

;(async () => {
    const ctx = await connect()
    const { d, signer, wallet } = ctx
    if (!d.eas) throw new Error("deployment.json has no `eas` entry: EAS runs on Base and OP-stack chains (predeploy 0x4200…0021)")
    const registry = new ethers.Contract(d.eas.registry, eas.REGISTRY_ABI, signer)
    const uid = eas.schemaUid()

    if (cmd === "register") {
        if ((await registry.getSchema(uid)).uid !== ethers.ZeroHash) return console.log(`schema already registered: ${uid}\n${d.eas.explorer}/schema/view/${uid}`)
        const tx = await registry.register(eas.SCHEMA, ethers.ZeroAddress, eas.REVOCABLE)
        await tx.wait()
        return console.log(`schema registered: ${uid} · ${tx.hash}\n${d.eas.explorer}/schema/view/${uid}`)
    }
    if (!/^\d+$/.test(a.program ?? "")) throw new Error("--program <id> is required")
    const pid = BigInt(a.program)

    if (cmd === "list") {
        const audits = await eas.listAudits({ graphql: d.eas.graphql, naungan: d.naungan, programId: pid })
        const s = eas.summarise(audits)
        console.log(`program ${pid}: ${s.auditors} independent auditor(s), ${s.clean} found every payout valid, ${s.flagged} flagged a payout`)
        for (const x of audits) console.log(`  ${new Date(x.time * 1000).toISOString()} ${x.attester} · ${x.verified}/${x.claims} verified at block ${x.atBlock} · ${d.eas.explorer}/attestation/view/${x.uid}`)
        return
    }
    if (cmd !== "audit") throw new Error("usage: eas.js register | audit --program <id> [--dry-run] | list --program <id>")

    const r = await collect(ctx, pid)
    const verified = r.res.filter((x) => x.ok).length
    for (const x of r.res) console.log(`  ${x.ok ? "✓" : "✗"} ${x.hash}${x.ok ? "" : "  " + Object.entries(x.checks).filter(([, v]) => v !== true).map(([k]) => k).join(", ")}`)
    console.log(`program ${pid} at block ${r.atBlock}: ${verified} of ${r.res.length} payouts verified against a group of ${r.members}`)
    if (!r.res.length) return console.log("no payouts yet: nothing to attest")
    if (a["dry-run"]) return
    if ((await registry.getSchema(uid)).uid === ethers.ZeroHash) throw new Error("the audit schema is not registered on this chain: run `node scripts/eas.js register` once")
    // The result is attested as found, failures included: a published "3 of 4" is exactly what donors need to see.
    const tx = await signer.sendTransaction({ to: d.eas.address, data: eas.attestCall(d.naungan, { programId: pid, claims: r.res.length, verified, members: r.members, groupRoot: r.root, atBlock: r.atBlock }) })
    const rcpt = await tx.wait()
    const id = eas.attestedUid(rcpt)
    console.log(`attested by ${wallet.address} · ${tx.hash}\n${d.eas.explorer}/attestation/view/${id}`)
})()
    .catch((e) => {
        console.error(explain(e))
        process.exitCode = 1
    })
    .finally(() => globalThis.curve_bn128?.terminate()) // snarkjs keeps a worker pool alive, which would hold the process open

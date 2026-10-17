#!/usr/bin/env node
// Flood oracle: computes the GloFAS trigger for a program from the hazard parameters stored on-chain
// and posts it with its evidence string.
//
//   node scripts/oracle.js --program 1                      one live assessment (ensemble forecast)
//   node scripts/oracle.js --program 1 --watch 6            re-assess every 6 hours until triggered
//   node scripts/oracle.js --program 1 --replay 2025-11-20  replay a real past event from reanalysis
//   node scripts/oracle.js --program 1 --dry-run            compute and print, send nothing
const { parseArgs } = require("util")
const { connect, programMeta, explain } = require("../lib/chain")
const hazard = require("../lib/hazard")
const { ethers } = require("ethers")

const { values: a } = parseArgs({
    options: { program: { type: "string" }, watch: { type: "string" }, replay: { type: "string" }, "dry-run": { type: "boolean" } }
})

async function once({ naungan, wallet }, pid) {
    const p = await naungan.programs(pid)
    if (p.coordinator === ethers.ZeroAddress) throw new Error(`program ${pid} does not exist`)
    if (p.claimDeadline > 0n) return console.log(`program ${pid}: already triggered`), true
    if (!a["dry-run"] && !(await naungan.isOracle(pid, wallet.address))) throw new Error(`this key (${wallet.address}) is not an oracle of program ${pid}`)
    const m = await programMeta(naungan, pid)
    const r = a.replay ? await hazard.replay({ ...m, date: a.replay }) : await hazard.assess(m)
    const above = BigInt(r.probability) >= p.triggerThreshold
    console.log(`${new Date().toISOString()} program ${pid} · ${m.name}\n  P(flood) = ${r.probability}% (trigger at ${p.triggerThreshold}%) → ${above ? "above trigger" : "below trigger"}\n  ${r.evidence}`)
    if (a["dry-run"]) return false
    const rcpt = await (await naungan.reportIndex(pid, r.probability, r.evidence)).wait()
    const ev = rcpt.logs.map((l) => naungan.interface.parseLog(l)).find((x) => x?.name === "IndexReported")
    console.log(`  posted: ${rcpt.hash} · ${ev.args.agreeing}/${p.quorum} oracles agree → ${ev.args.triggered ? "CLAIMS OPEN" : "waiting for quorum"}`)
    return ev.args.triggered
}

;(async () => {
    if (!/^\d+$/.test(a.program ?? "")) throw new Error("--program <id> is required")
    if (a.replay && !/^\d{4}-\d{2}-\d{2}$/.test(a.replay)) throw new Error("--replay must be YYYY-MM-DD")
    const ctx = await connect()
    const pid = BigInt(a.program)
    if (!a.watch) return once(ctx, pid)
    const hours = Number(a.watch)
    if (!(hours > 0)) throw new Error("--watch takes a number of hours")
    // ponytail: in-process timer; run under a supervisor (systemd, pm2, cron) for production uptime
    while (!(await once(ctx, pid).catch((e) => (console.error(`  error: ${explain(e)}`), false))))
        await new Promise((r) => setTimeout(r, hours * 3600e3))
})().catch((e) => {
    console.error(explain(e))
    process.exitCode = 1
})

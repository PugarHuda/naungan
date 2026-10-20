#!/usr/bin/env node
// Flood oracle: computes the trigger for a program from the hazard parameters stored on-chain and
// posts it with its evidence string. Each oracle runs the pipeline the program metadata assigns to
// its address (`pipelines`: "glofas" river discharge, "rain" NOAA GEFS catchment rainfall or "heat" NOAA GEFS
// maximum temperature; a heat program defaults to "heat"), so a
// 2-of-2 quorum needs two independent forecasts to agree. --source overrides it (e.g. for --dry-run).
//
//   node scripts/oracle.js --program 1                      one live assessment (ensemble forecast)
//   node scripts/oracle.js --program 1 --watch 6            re-assess every 6 hours until triggered
//   node scripts/oracle.js --program 1 --replay 2025-11-20  replay a real past event from reanalysis
//   node scripts/oracle.js --program 1 --dry-run            compute and print, send nothing
//   node scripts/oracle.js --program 4 --source rain --dry-run
//   node scripts/oracle.js --all                            every live program this key is an oracle of (no watch list to keep)
const { parseArgs } = require("util")
const { connect, programMeta, explain } = require("../lib/chain")
const hazard = require("../lib/hazard.mjs")
const { ethers } = require("ethers")

const { values: a } = parseArgs({
    options: { all: { type: "boolean" }, program: { type: "string" }, watch: { type: "string" }, replay: { type: "string" }, "dry-run": { type: "boolean" }, source: { type: "string" } }
})

async function once({ naungan, wallet }, pid) {
    const p = await naungan.programs(pid)
    if (p.coordinator === ethers.ZeroAddress) throw new Error(`program ${pid} does not exist`)
    if (p.claimDeadline > 0n) return console.log(`program ${pid}: already triggered`), true
    if (!a["dry-run"] && !(await naungan.isOracle(pid, wallet.address))) throw new Error(`this key (${wallet.address}) is not an oracle of program ${pid}`)
    const m = await programMeta(naungan, pid)
    const source = a.source ?? Object.entries(m.pipelines ?? {}).find(([o]) => o.toLowerCase() === wallet.address.toLowerCase())?.[1] ?? (m.hazard === "heat" ? "heat" : "glofas")
    const run = { glofas: [hazard.assess, hazard.replay], rain: [hazard.assessRain, hazard.replayRain], heat: [hazard.assessHeat, hazard.replayHeat] }[source]
    if (!run) throw new Error(`unknown pipeline "${source}" (glofas, rain or heat)`)
    const r = a.replay ? await run[1]({ ...m, date: a.replay }) : await run[0](m)
    const above = BigInt(r.probability) >= p.triggerThreshold
    console.log(`${new Date().toISOString()} program ${pid} · ${m.name}\n  P(${m.hazard === "heat" ? "heatwave" : "flood"}) = ${r.probability}% (trigger at ${p.triggerThreshold}%) → ${above ? "above trigger" : "below trigger"}\n  ${r.evidence}`)
    if (a["dry-run"]) return false
    const rcpt = await (await naungan.reportIndex(pid, r.probability, r.evidence)).wait()
    const ev = rcpt.logs.map((l) => naungan.interface.parseLog(l)).find((x) => x?.name === "IndexReported")
    console.log(`  posted: ${rcpt.hash} · ${ev.args.agreeing}/${p.quorum} oracles agree → ${ev.args.triggered ? "CLAIMS OPEN" : "waiting for quorum"}`)
    return ev.args.triggered
}

/**
 * Programs this key should report on now: it is one of their oracles, and they are neither triggered nor
 * past their season. Read from the chain, so a program launched from the browser is picked up on the next
 * run with no list to edit.
 */
async function mine({ naungan, wallet }) {
    const n = Number(await naungan.programCount()), now = Date.now() / 1000, out = []
    for (let pid = 1n; pid <= BigInt(n); pid++) {
        const p = await naungan.programs(pid)
        if (p.claimDeadline > 0n || now > Number(p.seasonEnd)) continue
        if (await naungan.isOracle(pid, wallet.address)) out.push(pid)
    }
    return out
}

/** The relayer and oracles pay gas from these keys: say so in the run log well before they run dry. */
const LOW_GAS = ethers.parseEther("0.01")
async function gasCheck({ wallet }) {
    const bal = await wallet.provider.getBalance(wallet.address)
    if (bal < LOW_GAS) console.log(`::warning::${wallet.address} has ${ethers.formatEther(bal)} ETH left for gas; top it up (scripts/topup.js)`)
}

;(async () => {
    if (a.all) {
        const ctx = await connect()
        const pids = await mine(ctx)
        console.log(`${ctx.wallet.address} is an oracle of ${pids.length} live program(s): ${pids.join(", ") || "none"}`)
        let failed = 0
        for (const pid of pids) await once(ctx, pid).catch((e) => (failed++, console.log(`::warning::program ${pid}: ${explain(e)}`)))
        await gasCheck(ctx)
        if (failed === pids.length && pids.length) process.exitCode = 1 // every report failed: make the run red
        return
    }
    if (!/^\d+$/.test(a.program ?? "")) throw new Error("--program <id> (or --all) is required")
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

#!/usr/bin/env node
// Production monitor: checks the live site the way a household, donor or alert system uses it, and lists what is
// wrong. Run hourly by .github/workflows/monitor.yml, which opens a GitHub issue while something is wrong and
// closes it when everything passes again.
//
//   node scripts/monitor.js [--base https://naungan.vercel.app]   exit 1 and one line per problem, or "all good"
const { parseArgs } = require("util")

const PAGES = ["/", "/dashboard", "/claim", "/launch", "/enroll", "/dedup", "/embed?program=1"]
// Oracles report every 6 hours; GitHub can delay a scheduled run by hours, so stale means two cycles missed.
const STALE_H = 13

/**
 * Pure: what the endpoints answered → the problems a person should act on. `r` maps a path to { status, body,
 * ms } (body parsed for JSON); `now` is unix seconds.
 */
function assess(r, now = Date.now() / 1000) {
    const out = []
    for (const p of PAGES) if (r[p]?.status !== 200) out.push(`page ${p} answered ${r[p]?.status ?? "nothing"}`)
    const h = r["/health"]
    if (h?.status !== 200) out.push(`relayer /health answered ${h?.status ?? "nothing"}: households cannot claim`)
    else {
        if (h.body.lowGas) out.push(`relayer ${h.body.relayer} is low on gas (${h.body.balance} ETH): top it up before claims open`)
        if (h.body.pinStore !== "upstash-redis") out.push(`relayer runs without its shared store (${h.body.pinStore}): PIN limits and claim locks are per instance`)
    }
    const a = r["/api/programs"]
    if (a?.status !== 200) out.push(`open data /api/programs answered ${a?.status ?? "nothing"}`)
    else {
        if (!a.body.programs?.length) out.push("open data lists no programs")
        for (const x of a.body.programs ?? []) {
            // The API works the shortfall out in exact token units (api/programs.js); 0 once a program is over.
            if (x.usdc?.shortfall > 0) out.push(`program #${x.id} (${x.name}): short by ${x.usdc.shortfall} USDC to pay its ${x.households.enrolled - x.households.paid} unpaid households ${x.usdc.perHousehold} USDC each; the last to claim would be refused`)
            if (x.state !== "watching") continue
            const at = x.latestReport ? Date.parse(x.latestReport.at) / 1000 : 0
            const h = (now - at) / 3600
            if (h > STALE_H) out.push(`program #${x.id} (${x.name}): no oracle report for ${at ? `${Math.round(h)} h` : "ever"}; the forecast is not being watched`)
        }
    }
    const cap = r["/cap.xml"]
    if (cap?.status !== 200 || !/<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/.test(cap.body ?? "")) out.push(`CAP alert index /cap.xml answered ${cap?.status ?? "nothing"}`)
    const iati = r["/iati.xml"]
    if (iati?.status !== 200 || !/<iati-activities version="2\.03"/.test(iati.body ?? "")) out.push(`IATI activities /iati.xml answered ${iati?.status ?? "nothing"}`)
    const feed = r["/feed.xml"]
    if (feed?.status !== 200 || !/<feed xmlns="http:\/\/www.w3.org\/2005\/Atom"/.test(feed.body ?? "")) out.push(`Atom feed /feed.xml answered ${feed?.status ?? "nothing"}`)
    const k = r["/push-key"]
    if (k?.status !== 200 || !/^[A-Za-z0-9_-]{87}$/.test(k.body?.key ?? "")) out.push(`/push-key answered ${k?.status ?? "nothing"}: phones cannot subscribe to alerts`)
    return out
}

async function get(base, path) {
    const t = Date.now()
    try {
        const res = await fetch(base + path, { signal: AbortSignal.timeout(45e3), headers: { "user-agent": "naungan-monitor" } })
        const text = await res.text()
        let body = text
        if (/json/.test(res.headers.get("content-type") ?? "")) try { body = JSON.parse(text) } catch {}
        return { status: res.status, body, ms: Date.now() - t }
    } catch (e) {
        return { status: null, body: String(e.message), ms: Date.now() - t }
    }
}

async function main() {
    const { values } = parseArgs({ options: { base: { type: "string", default: "https://naungan.vercel.app" } } })
    const paths = [...PAGES, "/health", "/api/programs", "/cap.xml", "/feed.xml", "/iati.xml", "/push-key"]
    const r = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await get(values.base, p)])))
    for (const p of paths) console.log(`${String(r[p].status).padEnd(4)} ${String(r[p].ms).padStart(6)} ms  ${p}`)
    const problems = assess(r)
    if (!problems.length) return console.log("all good")
    for (const x of problems) console.log(`::error::${x}`)
    process.exitCode = 1
}

if (require.main === module) main()
module.exports = { assess, PAGES, STALE_H }

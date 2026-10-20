// Atom feed of what happens on-chain: GET /feed.xml (all programs) or /feed.xml?program=N. Any feed reader,
// newsroom or agency system can follow a program without an account. Claims are grouped per program per
// day and never name a payout address: a feed of who was paid when would help link payouts to people.
const { ethers } = require("ethers")
const { readOnly, allEvents } = require("../lib/chain")
const { baseOf, CACHE } = require("./programs")

const MAX = 100
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
const iso = (unix) => new Date(Number(unix) * 1000).toISOString()
const name = (meta) => { try { return JSON.parse(meta).name || null } catch { return null } }

/**
 * Pure: events (oldest first, as allEvents returns them) → Atom XML. `program` limits it to one program;
 * `explorer` links each entry to its transaction (claims excepted).
 */
function buildFeed({ events, base, explorer, program = null, decimals = 6, now = Date.now() / 1000 }) {
    const usdc = (v) => ethers.formatUnits(v, decimals)
    const names = new Map()
    for (const e of events) if (e.name === "ProgramCreated") names.set(Number(e.args.programId), name(e.args.metadata))
    const label = (pid) => `Program #${pid}${names.get(pid) ? ` · ${names.get(pid)}` : ""}`
    const mine = events.filter((e) => e.args?.programId != null && (program == null || Number(e.args.programId) === program))
    const entries = []
    const claims = new Map() // "pid:day" → { pid, day, n, last }
    for (const e of mine) {
        const pid = Number(e.args.programId), at = e.timestamp, link = `${base}/dashboard.html?program=${pid}`
        const tx = explorer ? `${explorer}/tx/${e.transactionHash}` : null
        const id = `${e.transactionHash}:${e.index}`
        if (e.name === "Claimed") {
            const day = iso(at).slice(0, 10), k = `${pid}:${day}`
            const c = claims.get(k) ?? { pid, day, n: 0, last: at }
            c.n++, (c.last = Math.max(c.last, at)), claims.set(k, c)
        } else if (e.name === "ProgramCreated") {
            entries.push({ id, at, link, tx, title: `New program: ${label(pid)}`, text: `${usdc(e.args.amountPerHousehold)} USDC per household; claims open when the trigger reaches ${e.args.triggerThreshold}%.` })
        } else if (e.name === "IndexReported") {
            const head = e.args.triggered ? "CLAIMS OPEN · " : ""
            const n = e.args.agreeing, oracles = `${n} oracle${n == 1n ? "" : "s"}`
            const what = e.args.triggered ? `quorum reached, ${oracles} ${n == 1n ? "agrees" : "agree"}` : `${oracles} at or above the trigger`
            entries.push({ id, at, link, tx, title: `${head}${label(pid)}: ${e.args.value}% (${what})`, text: `Oracle ${e.args.oracle} reported ${e.args.value}%. Evidence: ${e.args.evidence}` })
        } else if (e.name === "Funded") {
            entries.push({ id, at, link, tx, title: `${label(pid)} funded: ${usdc(e.args.amount)} USDC`, text: `${e.args.donor} added ${usdc(e.args.amount)} USDC to the program's pool.` })
        } else if (e.name === "Refunded") {
            entries.push({ id, at, link, tx, title: `${label(pid)}: ${usdc(e.args.amount)} USDC refunded`, text: `Claims are over; ${e.args.donor} took back its pro-rata share of what was not claimed.` })
        }
    }
    for (const c of claims.values()) {
        entries.push({ id: `claims:${c.pid}:${c.day}`, at: c.last, link: `${base}/dashboard.html?program=${c.pid}`, tx: null, title: `${label(c.pid)}: ${c.n} household${c.n === 1 ? "" : "s"} paid on ${c.day}`, text: `${c.n} enrolled household${c.n === 1 ? "" : "s"} claimed with a zero-knowledge proof. Who they are, and which payout went to whom, is never on-chain.` })
    }
    entries.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    const shown = entries.slice(0, MAX)
    const host = new URL(base).host
    const self = `${base}/feed.xml${program != null ? `?program=${program}` : ""}`
    const title = program != null ? `Naungan · ${label(program)}` : "Naungan · all programs"
    const tag = (s) => `tag:${host},2026:${s}`
    return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(tag(program != null ? `program:${program}` : "programs"))}</id>
  <title>${esc(title)}</title>
  <subtitle>Triggers, funding and payouts of anticipatory cash programs, read from the chain.</subtitle>
  <updated>${iso(shown[0]?.at ?? now)}</updated>
  <author><name>Naungan</name><uri>${esc(base)}</uri></author>
  <link rel="self" type="application/atom+xml" href="${esc(self)}"/>
  <link rel="alternate" type="text/html" href="${esc(program != null ? `${base}/dashboard.html?program=${program}` : `${base}/`)}"/>
${shown
    .map(
        (x) => `  <entry>
    <id>${esc(tag(x.id))}</id>
    <title>${esc(x.title)}</title>
    <updated>${iso(x.at)}</updated>
    <link rel="alternate" type="text/html" href="${esc(x.link)}"/>${x.tx ? `\n    <link rel="related" type="text/html" title="Transaction" href="${esc(x.tx)}"/>` : ""}
    <content type="text">${esc(x.text)}</content>
  </entry>`
    )
    .join("\n")}
</feed>
`
}

module.exports = async (req, res) => {
    const q = new URL(req.url, "http://x").searchParams.get("program")
    if (q != null && !/^[1-9][0-9]{0,6}$/.test(q)) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
        return res.end("program must be a program number")
    }
    try {
        const { d, naungan } = readOnly()
        const events = await allEvents(naungan, d.fromBlock ?? 0)
        const xml = buildFeed({ events, base: baseOf(req, d), explorer: d.explorer, program: q == null ? null : Number(q) })
        res.writeHead(200, { "content-type": "application/atom+xml; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE })
        res.end(xml)
    } catch (e) {
        console.error("feed failed", e)
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
        res.end("chain unreachable right now, try again shortly")
    }
}
module.exports.buildFeed = buildFeed
module.exports.esc = esc

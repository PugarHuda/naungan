// Open data: GET /api/programs → every program as JSON, read from the chain with no key (CORS *).
// The CDN keeps each answer for 5 minutes, so the RPC and indexer are read once per window, not per visitor.
const { ethers } = require("ethers")
const { readOnly, allEvents } = require("../lib/chain")

const CACHE = "public, s-maxage=300, stale-while-revalidate=600"

/** The trigger in words, as the landing page and dashboard state it. */
function rule(m, threshold) {
    if (m.hazard === "heat") {
        const h = m.heat ?? {}
        return `Heatwave: ${h.days ?? 2}+ days above ${h.tmax ?? 38} °C${h.tmin != null ? `, nights above ${h.tmin} °C` : ""}, at least ${threshold}% of NOAA GEFS members, ${m.leadDays}-day lead`
    }
    return `River flood: at least ${threshold}% of GloFAS members above the 1-in-${m.returnPeriod}-year flood, ${m.leadDays}-day lead${m.rain ? ", confirmed by NOAA GEFS rainfall (2-of-2)" : ""}`
}

const iso = (unix) => new Date(Number(unix) * 1000).toISOString()

/**
 * Pure: program structs, metadata and events → the public summary. `programs` is [{ id, p, meta }] with
 * p as Naungan.programs() returns it; `events` as lib/chain.js allEvents returns them.
 */
function summarise({ programs, events, decimals = 6, base, now = Date.now() / 1000, countries = {} }) {
    const usdc = (v) => Number(ethers.formatUnits(v, decimals))
    const last = new Map()
    for (const e of events) if (e.name === "IndexReported") last.set(Number(e.args.programId), e) // oldest first: the last one wins
    return programs.map(({ id, p, meta }) => {
        const deadline = Number(p.claimDeadline), season = Number(p.seasonEnd)
        const state = deadline > 0 ? (now > deadline ? { state: "over", since: iso(deadline) } : { state: "claims open", until: iso(deadline) }) : now > season ? { state: "over", since: iso(season) } : { state: "watching", seasonEnds: iso(season) }
        const r = last.get(id)
        return {
            id,
            name: meta.name ?? `Program ${id}`,
            hazard: meta.hazard === "heat" ? "heat" : "flood",
            country: meta.country ?? countries[id] ?? null,
            lat: meta.lat ?? null,
            lon: meta.lon ?? null,
            trigger: { rule: rule(meta, p.triggerThreshold.toString()), thresholdPercent: Number(p.triggerThreshold), lastIndexPercent: Number(p.lastIndex), quorum: Number(p.quorum) },
            ...state,
            usdc: { perHousehold: usdc(p.amountPerHousehold), funded: usdc(p.funded), paidOut: usdc(p.claims * p.amountPerHousehold) },
            households: { enrolled: Number(p.enrolled), paid: Number(p.claims) },
            latestReport: r ? { valuePercent: Number(r.args.value), agreeing: Number(r.args.agreeing), triggered: r.args.triggered, evidence: r.args.evidence, at: iso(r.timestamp), tx: r.transactionHash } : null,
            links: { dashboard: `${base}/dashboard.html?program=${id}`, join: `${base}/claim.html#join=${id}`, feed: `${base}/feed.xml?program=${id}` }
        }
    })
}

/** Country of a point (BigDataCloud's keyless endpoint, as the web pages use); null when it fails. */
async function countryOf(lat, lon) {
    try {
        const j = await (await fetch(`https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { signal: AbortSignal.timeout(5000) })).json()
        return /^[A-Z]{2}$/.test(j.countryCode ?? "") ? j.countryCode : null
    } catch {
        return null
    }
}

async function load() {
    const { d, naungan, provider } = readOnly()
    const n = Number(await naungan.programCount())
    const ids = Array.from({ length: n }, (_, i) => i + 1)
    const token = new ethers.Contract(await naungan.token(), ["function decimals() view returns (uint8)"], provider)
    const [ps, metas, events, decimals] = await Promise.all([
        Promise.all(ids.map((i) => naungan.programs(i))),
        Promise.all(ids.map((i) => naungan.metadata(i).then((t) => { try { return JSON.parse(t) } catch { return {} } }))),
        allEvents(naungan, d.fromBlock ?? 0),
        token.decimals()
    ])
    const programs = ids.map((id, i) => ({ id, p: ps[i], meta: metas[i] }))
    const countries = Object.fromEntries(await Promise.all(programs.filter((x) => !x.meta.country && Number.isFinite(x.meta.lat)).map(async (x) => [x.id, await countryOf(x.meta.lat, x.meta.lon)])))
    return { d, programs, events, decimals: Number(decimals), countries }
}

/**
 * HXL (Humanitarian Exchange Language, hxlstandard.org): the CSV convention OCHA's HDX and humanitarian data
 * tools read. Row 1 is for people, row 2 the HXL hashtags tools key on; then one row per program.
 */
const HXL = [
    ["Program id", "#activity+id", (x) => x.id],
    ["Program", "#activity+name", (x) => x.name],
    ["Hazard", "#crisis+type", (x) => x.hazard],
    ["Country (ISO 3166)", "#country+code", (x) => x.country],
    ["Latitude", "#geo+lat", (x) => x.lat],
    ["Longitude", "#geo+lon", (x) => x.lon],
    ["State", "#status", (x) => x.state],
    ["Trigger rule", "#indicator+trigger+text", (x) => x.trigger.rule],
    ["Trigger %", "#indicator+threshold+pct", (x) => x.trigger.thresholdPercent],
    ["Last forecast %", "#indicator+value+pct", (x) => x.trigger.lastIndexPercent],
    ["USDC per household", "#value+transfer+usd", (x) => x.usdc.perHousehold],
    ["USDC funded", "#value+funding+usd", (x) => x.usdc.funded],
    ["USDC paid out", "#value+disbursed+usd", (x) => x.usdc.paidOut],
    ["Households enrolled", "#targeted+hh+num", (x) => x.households.enrolled],
    ["Households paid", "#reached+hh+num", (x) => x.households.paid],
    ["Dashboard", "#meta+url", (x) => x.links.dashboard]
]
/** RFC 4180 cell; a leading = + - @ is prefixed so a spreadsheet never runs on-chain text as a formula. */
const cell = (v) => {
    let s = v == null ? "" : String(v)
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const hxlCsv = (programs) => [HXL.map((c) => c[0]), HXL.map((c) => c[1]), ...programs.map((x) => HXL.map((c) => c[2](x)))].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"

const baseOf = (req, d) => (req.headers?.host ? `https://${req.headers["x-forwarded-host"] ?? req.headers.host}` : d.relayer ?? "")

module.exports = async (req, res) => {
    try {
        const data = await load()
        const programs = summarise({ ...data, base: baseOf(req, data.d) })
        if (new URL(req.url, "http://x").searchParams.get("format") === "csv") {
            res.writeHead(200, { "content-type": "text/csv; charset=utf-8; header=present", "content-disposition": 'inline; filename="naungan-programs.csv"', "access-control-allow-origin": "*", "cache-control": CACHE })
            return res.end(hxlCsv(programs))
        }
        const body = { contract: data.d.naungan, chainId: data.d.chainId, generatedAt: new Date().toISOString(), programs }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE })
        res.end(JSON.stringify(body, null, 2))
    } catch (e) {
        console.error("programs failed", e)
        res.writeHead(503, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" })
        res.end(JSON.stringify({ error: "chain unreachable right now, try again shortly" }))
    }
}
module.exports.summarise = summarise
module.exports.hxlCsv = hxlCsv
module.exports.HXL = HXL
module.exports.rule = rule
module.exports.load = load
module.exports.baseOf = baseOf
module.exports.CACHE = CACHE

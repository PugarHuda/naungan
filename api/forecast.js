// GET /api/forecast?program=N → the 30-day GloFAS river forecast and 1-in-T-year flood level of a flood program, for
// the landing page's chart. Open-Meteo's free tier limits requests per IP address, so a room of visitors on one network
// (a demo day) would each hit it, and the landing's chart would fail for some; behind this edge-cached copy, each CDN
// region asks Open-Meteo once an hour. The coordinates come from the program's own on-chain metadata, never the
// request, and the threshold from the oracles' own code (lib/hazard.mjs). The dashboard's re-check of an oracle still
// reads Open-Meteo directly in the visitor's browser: that one must not trust us.
const { readOnly } = require("../lib/chain")

const CACHE = "public, s-maxage=3600, stale-while-revalidate=21600, stale-if-error=86400"
const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }

module.exports = async (req, res) => {
    const send = (code, body, cache) => (res.writeHead(code, { ...HEADERS, "cache-control": cache }), res.end(JSON.stringify(body)))
    const m = /^\?program=([1-9]\d{0,5})$/.exec(new URL(req.url, "http://x").search) // one spelling, one CDN entry
    if (!m) return send(400, { error: "use ?program=<id> exactly" }, "public, s-maxage=86400")
    try {
        const { naungan } = readOnly()
        const id = Number(m[1])
        if (id > Number(await naungan.programCount())) return send(404, { error: `no program ${id}` }, "public, s-maxage=300")
        let meta = {}
        try { meta = JSON.parse(await naungan.metadata(id)) } catch {}
        if ((meta.hazard ?? "flood") !== "flood" || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lon)) return send(404, { error: `program ${id} is not a flood program with a place` }, "public, s-maxage=3600")
        const { floodThreshold } = await import("../lib/hazard.mjs")
        const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${meta.lat}&longitude=${meta.lon}&daily=river_discharge_median,river_discharge_max&forecast_days=30`
        const [r, t] = await Promise.all([fetch(url, { signal: AbortSignal.timeout(20e3) }), floodThreshold({ lat: meta.lat, lon: meta.lon, returnPeriod: meta.returnPeriod ?? 5 })])
        if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`)
        const j = await r.json()
        const median = j.daily.river_discharge_median
        const peak = Math.max(...median.slice(0, 11).filter((v) => v != null))
        send(200, { program: id, time: j.daily.time, median, max: j.daily.river_discharge_max, threshold: t.threshold, peak, source: url, fetchedAt: new Date().toISOString() }, CACHE)
    } catch (e) {
        console.error("forecast failed", e.message)
        send(503, { error: "the forecast is unavailable right now" }, "no-store")
    }
}

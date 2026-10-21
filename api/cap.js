// Common Alerting Protocol 1.2 (OASIS, ITU-T X.1303), the format national alert systems, WMO's Alert Hub
// and alert aggregators ingest. When a program's trigger opens claims, that is an anticipatory alert for an
// area, so each triggered program is published as a CAP alert:
//   GET /cap.xml                 Atom index of every alert, each linking its CAP message (the CAP feed convention)
//   GET /api/cap?program=N       the CAP 1.2 message for program N (404 if its trigger never fired)
// Honesty rule: a testnet deployment, or a trigger fired by a REPLAY of a past event, is status "Exercise",
// never "Actual", so no aggregator mistakes it for a live emergency.
const { load, baseOf, CACHE, rule } = require("./programs")

const TESTNETS = new Set([84532, 31337, 11155111])
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[^\x09\x0A\x0D\x20-퟿-�]/gu, "")
/** CAP dateTime: "2026-10-19T10:00:00+00:00" (no fraction, no "Z"). */
const capTime = (unix) => new Date(Number(unix) * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00")
const el = (tag, v) => (v == null || v === "" ? "" : `<${tag}>${esc(v)}</${tag}>`)

/**
 * Pure: one program whose trigger fired → a CAP 1.2 alert. `report` is the IndexReported event that opened
 * claims (args.triggered), with its block `timestamp`; `country` an ISO 3166 alpha-2 code or null.
 */
function capAlert({ id, p, meta, report, country, d, base, decimals = 6 }) {
    const usdc = Number(p.amountPerHousehold) / 10 ** decimals
    const heat = meta.hazard === "heat"
    const replay = /^REPLAY/.test(report.args.evidence)
    const exercise = TESTNETS.has(Number(d.chainId)) || replay
    const place = (meta.name ?? `Program ${id}`).split(" · ")
    const value = Number(report.args.value)
    const params = [
        ["naungan:program", id],
        ["naungan:contract", `${d.chainId}:${d.naungan}`],
        ["naungan:trigger", rule(meta, p.triggerThreshold.toString())],
        ["naungan:probabilityPercent", value],
        ["naungan:usdcPerHousehold", usdc],
        ["naungan:evidence", report.args.evidence],
        ["naungan:tx", report.transactionHash]
    ]
    const note = [TESTNETS.has(Number(d.chainId)) && "testnet deployment", replay && "triggered by a replay of a past event, not a live forecast"].filter(Boolean).join("; ")
    return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
${el("identifier", `naungan-${d.chainId}-${id}-${report.transactionHash}`)}
${el("sender", new URL(base).host)}
${el("sent", capTime(report.timestamp))}
${el("status", exercise ? "Exercise" : "Actual")}
<msgType>Alert</msgType>
${el("source", "Naungan oracle quorum (Copernicus GloFAS / NOAA GEFS via Open-Meteo)")}
<scope>Public</scope>
${el("note", note)}
<info>
<language>en-US</language>
<category>Met</category>
${el("event", heat ? "Heatwave forecast" : "River flood forecast")}
<responseType>Prepare</responseType>
<urgency>Future</urgency>
${el("severity", heat || (meta.returnPeriod ?? 5) >= 10 ? "Severe" : "Moderate")}
${el("certainty", value > 50 ? "Likely" : "Possible")}
<eventCode><valueName>naungan:hazard</valueName><value>${heat ? "heat" : "flood"}</value></eventCode>
${el("effective", capTime(report.timestamp))}
${el("expires", capTime(p.claimDeadline))}
<senderName>Naungan anticipatory cash</senderName>
${el("headline", `Anticipatory cash released: ${place[0]} (${value}% forecast probability)`)}
${el("description", `${rule(meta, p.triggerThreshold.toString())}. The oracle quorum reported ${value}% (trigger ${p.triggerThreshold}%), so enrolled households can claim ${usdc} USDC each until the claim window closes. Evidence: ${report.args.evidence}`)}
${el("instruction", "Households enrolled in this program: open your Naungan card and tap Claim before the window closes. Agencies: tell enrolled households that claims are open.")}
${el("web", `${base}/dashboard?program=${id}`)}
${params.map(([k, v]) => `<parameter><valueName>${esc(k)}</valueName><value>${esc(v)}</value></parameter>`).join("\n")}
<area>
${el("areaDesc", place.slice(1).join(", ") || place[0])}
${Number.isFinite(meta.lat) ? el("circle", `${meta.lat},${meta.lon} 25`) : ""}
${country ? `<geocode><valueName>ISO3166-1</valueName><value>${esc(country)}</value></geocode>` : ""}
</area>
</info>
</alert>
`.replace(/\n{2,}/g, "\n")
}

/** Pure: the triggered programs → an Atom index whose entries link each CAP message (application/cap+xml). */
function capIndex({ alerts, base, now = Date.now() / 1000 }) {
    const updated = capTime(alerts.reduce((m, a) => Math.max(m, a.report.timestamp), 0) || now)
    const entries = alerts
        .sort((a, b) => b.report.timestamp - a.report.timestamp)
        .map((a) => `<entry>
<id>${esc(`${base}/api/cap?program=${a.id}`)}</id>
<title>${esc(`${a.meta.hazard === "heat" ? "Heatwave" : "River flood"} forecast: ${(a.meta.name ?? `Program ${a.id}`).split(" · ")[0]}`)}</title>
<updated>${capTime(a.report.timestamp)}</updated>
<link rel="alternate" type="application/cap+xml" href="${esc(`${base}/api/cap?program=${a.id}`)}"/>
<link rel="related" type="text/html" href="${esc(`${base}/dashboard?program=${a.id}`)}"/>
<summary>${esc(`Trigger fired at ${a.report.args.value}%; claims open until ${capTime(a.p.claimDeadline)}`)}</summary>
</entry>`)
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${esc(`${base}/cap.xml`)}</id>
<title>Naungan CAP alerts</title>
<subtitle>Common Alerting Protocol 1.2 messages for every program whose anticipatory trigger fired</subtitle>
<updated>${updated}</updated>
<author><name>Naungan</name></author>
<link rel="self" type="application/atom+xml" href="${esc(`${base}/cap.xml`)}"/>
${entries.join("\n")}
</feed>
`
}

/** Triggered programs with the report that opened claims. */
function triggered({ programs, events, countries }) {
    const opened = new Map()
    for (const e of events) if (e.name === "IndexReported" && e.args.triggered) opened.set(Number(e.args.programId), e)
    return programs.filter(({ id, p }) => p.claimDeadline > 0n && opened.has(id)).map(({ id, p, meta }) => ({ id, p, meta, report: opened.get(id), country: meta.country ?? countries[id] ?? null }))
}

module.exports = async (req, res) => {
    const url = new URL(req.url, "http://x")
    const program = url.searchParams.get("program")
    if (program != null && !/^\d{1,9}$/.test(program)) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" })
        return res.end("program must be a program id")
    }
    try {
        const data = await load()
        const base = baseOf(req, data.d)
        const alerts = triggered(data)
        if (program == null) {
            res.writeHead(200, { "content-type": "application/atom+xml; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE })
            return res.end(capIndex({ alerts, base }))
        }
        const a = alerts.find((x) => x.id === Number(program))
        if (!a) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE })
            return res.end(`program ${program} has no alert: its trigger has not fired`)
        }
        res.writeHead(200, { "content-type": "application/cap+xml; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE })
        res.end(capAlert({ ...a, d: data.d, base, decimals: data.decimals }))
    } catch (e) {
        console.error("cap failed", e)
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" })
        res.end("chain unreachable right now, try again shortly")
    }
}
module.exports.capAlert = capAlert
module.exports.capIndex = capIndex
module.exports.triggered = triggered

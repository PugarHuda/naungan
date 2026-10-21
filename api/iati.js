// IATI (International Aid Transparency Initiative) 2.03 activity XML: GET /iati.xml. IATI is where humanitarian
// funding is published for the Grand Bargain's transparency commitment; d-portal, OCHA's Financial Tracking Service
// and donors' own systems read it. Each program is one activity, with its money as transactions read from the chain:
// donations are incoming funds, refunds of unclaimed money negative incoming funds, and payouts one disbursement per
// program per day, never per household (as the Atom feed: a list of who was paid when helps link payouts to people).
// USDC is a 1:1 dollar-redeemable stablecoin, so values are stated in USD (IATI's currency codes are ISO 4217).
// The XML is generated from the chain by this site, not by an agency, so reporting-org carries secondary-reporter="1".
// Its ref defaults to an identifier of this deployment, NAUNGAN-<chain>-<contract>, which is not a registered
// organisation identifier (org-id.guide); an agency publishing this to the IATI Registry sets IATI_ORG to its own,
// and every activity identifier then starts with it, as IATI's identifier rule asks.
const { ethers } = require("ethers")
const { load, baseOf, CACHE, rule } = require("./programs")

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
const day = (unix) => new Date(Number(unix) * 1000).toISOString().slice(0, 10)
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`
const text = (tag, s, attrs = "") => `<${tag}${attrs}><narrative>${esc(s)}</narrative></${tag}>`

/**
 * Pure: programs (as api/programs.js load() returns them) and their events → an <iati-activities> document.
 * Status: 2 Implementation while watching or claims are open, 4 Closed once over.
 */
function iatiXml({ programs, events, d, base, decimals = 6, countries = {}, now = Date.now() / 1000, org = process.env.IATI_ORG || `NAUNGAN-${d.chainId}-${d.naungan}` }) {
    const usd = (v) => ethers.formatUnits(v, decimals).replace(/\.0$/, "")
    const created = new Map(), byProgram = new Map()
    for (const e of events) {
        const pid = e.args?.programId != null ? Number(e.args.programId) : null
        if (pid == null) continue
        if (e.name === "ProgramCreated") created.set(pid, e)
        ;(byProgram.get(pid) ?? byProgram.set(pid, []).get(pid)).push(e)
    }
    const activities = programs.map(({ id, p, meta }) => {
        const ref = `${org}-${id}`
        const name = meta.name ?? `Program ${id}`
        const country = meta.country ?? countries[id] ?? null
        const deadline = Number(p.claimDeadline), season = Number(p.seasonEnd)
        const over = deadline > 0 ? now > deadline : now > season
        const start = created.get(id)?.timestamp
        const evs = byProgram.get(id) ?? []
        const tx = []
        const paid = new Map() // day → { n }
        for (const e of evs) {
            if (e.name === "Funded")
                tx.push(`<transaction ref="${esc(e.transactionHash)}" humanitarian="1"><transaction-type code="1"/><transaction-date iso-date="${day(e.timestamp)}"/><value currency="USD" value-date="${day(e.timestamp)}">${usd(e.args.amount)}</value>${text("description", `Donation of ${usd(e.args.amount)} USDC to the program's on-chain pool`)}${text("provider-org", `Donor ${short(e.args.donor)}`)}</transaction>`)
            else if (e.name === "Refunded")
                tx.push(`<transaction ref="${esc(e.transactionHash)}" humanitarian="1"><transaction-type code="1"/><transaction-date iso-date="${day(e.timestamp)}"/><value currency="USD" value-date="${day(e.timestamp)}">-${usd(e.args.amount)}</value>${text("description", "Unclaimed funds returned to the donor, pro rata, after the claim window closed")}${text("receiver-org", `Donor ${short(e.args.donor)}`)}</transaction>`)
            else if (e.name === "Claimed") {
                const k = day(e.timestamp), c = paid.get(k) ?? { n: 0 }
                c.n++, paid.set(k, c)
            }
        }
        for (const [k, c] of paid)
            tx.push(`<transaction humanitarian="1"><transaction-type code="3"/><transaction-date iso-date="${k}"/><value currency="USD" value-date="${k}">${usd(BigInt(c.n) * p.amountPerHousehold)}</value>${text("description", `${c.n} enrolled household${c.n === 1 ? "" : "s"} paid ${usd(p.amountPerHousehold)} USDC each, claimed with a zero-knowledge proof`)}${text("receiver-org", `${c.n} anonymous enrolled household${c.n === 1 ? "" : "s"}`)}<aid-type code="1" vocabulary="4"/></transaction>`)
        const located = Number.isFinite(meta.lat) && Number.isFinite(meta.lon)
        return `<iati-activity last-updated-datetime="${new Date(now * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")}" xml:lang="en" default-currency="USD" humanitarian="1">
<iati-identifier>${esc(ref)}</iati-identifier>
<reporting-org ref="${esc(org)}" type="90" secondary-reporter="1"><narrative>Naungan open data (generated from contract ${esc(d.naungan)} on chain ${esc(d.chainId)})</narrative></reporting-org>
${text("title", name)}
${text("description", `Anticipatory cash: ${usd(p.amountPerHousehold)} USDC per enrolled household, released automatically when the forecast trigger is met. ${rule(meta, p.triggerThreshold.toString())}. Enrolled households claim privately with a zero-knowledge proof.`, ' type="1"')}
${text("participating-org", `Program coordinator ${p.coordinator}`, ' role="4" type="90"')}
<activity-status code="${over ? 4 : 2}"/>
${start ? `<activity-date type="2" iso-date="${day(start)}"/>` : ""}
<activity-date type="3" iso-date="${day(season)}"/>
${over ? `<activity-date type="4" iso-date="${day(deadline > 0 ? deadline : season)}"/>` : ""}
${country ? `<recipient-country code="${esc(country)}" percentage="100"/>` : ""}
${located ? `<location><location-reach code="2"/>${text("name", name.split(" · ").slice(1).join(", ") || name)}<point srsName="http://www.opengis.net/def/crs/EPSG/0/4326"><pos>${meta.lat} ${meta.lon}</pos></point><exactness code="2"/></location>` : ""}
<sector vocabulary="1" code="74020" percentage="100"/>
<default-finance-type code="110"/>
<default-aid-type code="1" vocabulary="4"/>
${tx.sort((a, b) => a.match(/iso-date="([^"]+)"/)[1].localeCompare(b.match(/iso-date="([^"]+)"/)[1])).join("\n")}
<document-link format="text/html" url="${esc(`${base}/dashboard?program=${id}`)}">${text("title", "Live program dashboard: trigger, pool and payouts read from the chain")}<category code="A12"/><language code="en"/></document-link>
</iati-activity>`.replace(/\n{2,}/g, "\n")
    })
    return `<?xml version="1.0" encoding="UTF-8"?>
<iati-activities version="2.03" generated-datetime="${new Date(now * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")}">
${activities.join("\n")}
</iati-activities>
`
}

module.exports = async (req, res) => {
    try {
        const data = await load()
        res.writeHead(200, { "content-type": "application/xml; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE })
        res.end(iatiXml({ ...data, base: baseOf(req, data.d) }))
    } catch (e) {
        console.error("iati failed", e)
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" })
        res.end("chain unreachable right now, try again shortly")
    }
}
module.exports.iatiXml = iatiXml

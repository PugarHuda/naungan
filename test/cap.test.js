const { expect } = require("chai")
const { spawnSync } = require("child_process")
const path = require("path")
const { capAlert, capIndex, triggered } = require("../api/cap")
const { hxlCsv, HXL, summarise, geojson } = require("../api/programs")

// Validates XML against the official OASIS CAP 1.2 schema (test/fixtures/CAP-v1.2.xsd) with Python's lxml.
const py = ["python3", "python"].find((c) => spawnSync(c, ["-c", "import lxml"]).status === 0)
const capValid = (xml) => {
    const xsd = path.join(__dirname, "fixtures", "CAP-v1.2.xsd")
    const code = `import sys\nfrom lxml import etree\ns = etree.XMLSchema(etree.parse(sys.argv[1]))\nd = etree.fromstring(sys.stdin.buffer.read())\nok = s.validate(d)\nprint("ok" if ok else s.error_log)`
    // No -I: CI installs lxml with pip --user, which isolated mode would hide. The script and inputs are our own.
    const r = spawnSync(py, ["-c", code, xsd], { input: xml })
    return r.stdout.toString().trim() || r.stderr.toString().trim()
}

const d = { chainId: 84532, naungan: "0x00E9E8F7a9E8Dd4923Eb92eC5536f70ecD0C70f4" }
const p = { claimDeadline: 1793634298n, triggerThreshold: 60n, amountPerHousehold: 2_000_000n, lastIndex: 100n, quorum: 1n, funded: 6_000_000n, claims: 3n, enrolled: 3n, seasonEnd: 1800000000n }
const meta = { name: "Krueng Aceh flood · Banda Aceh", hazard: "flood", lat: 5.575, lon: 95.325, returnPeriod: 5, leadDays: 10 }
const report = (evidence) => ({ name: "IndexReported", args: { programId: 1n, value: 100n, agreeing: 1n, triggered: true, evidence, oracle: "0x812D" }, transactionHash: "0xada8", timestamp: 1792424698 })

describe("CAP 1.2 alerts and HXL open data", () => {
    it("a fired trigger is a CAP 1.2 alert that passes the official OASIS schema, marked Exercise on a testnet or a replay", function () {
        const live = capAlert({ id: 1, p, meta, report: report("GloFAS v4 via Open-Meteo | run 2026-10-20"), country: "ID", d: { ...d, chainId: 8453 }, base: "https://naungan.vercel.app" })
        const replay = capAlert({ id: 1, p, meta, report: report("REPLAY of GloFAS v4 reanalysis <not live> & co"), country: "ID", d, base: "https://naungan.vercel.app" })
        expect(live).to.include("<status>Actual</status>").and.not.include("<note>")
        expect(replay).to.include("<status>Exercise</status>").and.include("testnet deployment; triggered by a replay")
        expect(replay).to.include("<sent>2026-10-19T15:44:58+00:00</sent>") // CAP dateTime: no fraction, no Z
        expect(replay).to.include("&lt;not live&gt; &amp; co") // evidence escaped
        expect(replay).to.include("<circle>5.575,95.325 25</circle>").and.include("<value>ID</value>")
        expect(capAlert({ id: 6, p, meta: { name: "Dhaka heatwave", hazard: "heat", lat: 23.8, lon: 90.4, leadDays: 7, heat: { tmax: 38, days: 2 } }, report: report("NOAA GEFS"), country: null, d, base: "https://x.org" }))
            .to.include("<event>Heatwave forecast</event>").and.include("<severity>Severe</severity>").and.not.include("<geocode>")
        if (!py) return this.skip() // the schema check needs Python with lxml (CI installs it)
        for (const xml of [live, replay]) expect(capValid(xml)).to.equal("ok")
    })

    it("only programs whose trigger fired get an alert, with the report that opened claims", () => {
        const programs = [{ id: 1, p, meta }, { id: 2, p: { ...p, claimDeadline: 0n }, meta }]
        const events = [report("first"), { ...report("opened"), transactionHash: "0xbb" }, { name: "IndexReported", args: { programId: 2n, triggered: false } }]
        const alerts = triggered({ programs, events, countries: { 1: "ID" } })
        expect(alerts.map((a) => [a.id, a.report.transactionHash, a.country])).to.deep.equal([[1, "0xbb", "ID"]])
        const idx = capIndex({ alerts, base: "https://naungan.vercel.app" })
        expect(idx).to.include('type="application/cap+xml" href="https://naungan.vercel.app/api/cap?program=1"')
    })

    it("open data as HXL CSV: a people row, a hashtag row, one row per program, and no formula injection", () => {
        const [x] = summarise({ programs: [{ id: 1, p, meta: { ...meta, name: "=cmd|' /C calc'!A0" } }], events: [], base: "https://n.app", now: 1792424698, countries: { 1: "ID" } })
        const rows = hxlCsv([x]).trimEnd().split("\r\n")
        expect(rows).to.have.length(3)
        expect(rows[1].split(",")).to.deep.equal(HXL.map((c) => c[1]))
        for (const tag of rows[1].split(",")) expect(tag).to.match(/^#[a-z][a-z0-9_]*(\+[a-z][a-z0-9_]*)*$/) // HXL hashtag syntax
        expect(rows[2]).to.match(/^1,"?'=cmd/) // a spreadsheet shows the text instead of running it
        expect(rows[2]).to.include(",ID,5.575,95.325,claims open,")
    })

    it("GeoJSON (RFC 7946): one Point per located program, [lon, lat], with the HXL columns as properties", () => {
        const xs = summarise({ programs: [{ id: 1, p, meta }, { id: 2, p, meta: { name: "nowhere" } }], events: [], base: "https://n.app", now: 1792424698, countries: { 1: "ID" } })
        const g = JSON.parse(JSON.stringify(geojson(xs)))
        expect(g.type).to.equal("FeatureCollection")
        expect(g.features).to.have.length(1) // program 2 has no coordinates
        const [f] = g.features
        expect(f).to.include({ type: "Feature", id: 1 })
        expect(f.geometry).to.deep.equal({ type: "Point", coordinates: [95.325, 5.575] }) // longitude first
        expect(f.properties).to.include({ "Program id": 1, "Country (ISO 3166)": "ID", State: "claims open", "USDC per household": 2 })
        expect(f.properties).to.not.have.property("Latitude")
    })
})

const { expect } = require("chai")
const { assess, PAGES } = require("../scripts/monitor")

const now = 1792500000
const iso = (h) => new Date((now - h * 3600) * 1000).toISOString()
const healthy = () => ({
    ...Object.fromEntries(PAGES.map((p) => [p, { status: 200 }])),
    "/health": { status: 200, body: { relayer: "0x812D", balance: "0.04", lowGas: false, pinStore: "upstash-redis" } },
    "/api/programs": { status: 200, body: { programs: [{ id: 1, name: "Aceh", state: "claims open", latestReport: { at: iso(30) } }, { id: 3, name: "Krueng", state: "watching", latestReport: { at: iso(5) } }] } },
    "/cap.xml": { status: 200, body: '<?xml version="1.0"?>\n<feed xmlns="http://www.w3.org/2005/Atom">' },
    "/iati.xml": { status: 200, body: '<?xml version="1.0" encoding="UTF-8"?>\n<iati-activities version="2.03" generated-datetime="2026-10-20T00:00:00Z">' },
    "/push-key": { status: 200, body: { key: "B" + "a".repeat(86) } }
})

describe("production monitor", () => {
    it("a healthy site has no problems (an open program's old report is fine: its oracle has stopped by design)", () => {
        expect(assess(healthy(), now)).to.deep.equal([])
    })

    it("names each problem a person must act on", () => {
        const r = healthy()
        r["/claim"] = { status: 500 }
        r["/health"].body.lowGas = true
        r["/health"].body.pinStore = "memory"
        r["/api/programs"].body.programs.push({ id: 7, name: "Mpologoma", state: "watching", latestReport: { at: iso(20) } }, { id: 9, name: "New", state: "watching", latestReport: null })
        r["/push-key"] = { status: 503, body: { error: "relayer unavailable" } }
        r["/iati.xml"] = { status: 200, body: "<html>an error page</html>" }
        const p = assess(r, now)
        expect(p).to.have.length(7)
        expect(p[0]).to.equal("page /claim answered 500")
        expect(p.join("\n")).to.include("low on gas").and.include("without its shared store").and.include("#7 (Mpologoma): no oracle report for 20 h").and.include("#9 (New): no oracle report for ever").and.include("/push-key answered 503").and.include("IATI activities /iati.xml answered 200")
    })

    it("an unreachable relayer or API is reported, not crashed on", () => {
        const r = healthy()
        r["/health"] = { status: null, body: "fetch failed" }
        r["/api/programs"] = { status: 503, body: { error: "chain unreachable" } }
        delete r["/cap.xml"]
        expect(assess(r, now)).to.deep.equal(["relayer /health answered nothing: households cannot claim", "open data /api/programs answered 503", "CAP alert index /cap.xml answered nothing"])
    })
})

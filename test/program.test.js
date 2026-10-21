const { expect } = require("chai")
const { PRESETS, buildMeta } = require("../lib/program.mjs")
const { riverCell } = require("../lib/hazard.mjs")

describe("program metadata and river snapping", () => {
    it("builds the same metadata the oracles read, and names the field that is out of range", () => {
        const flood = buildMeta({ name: " Aguán river flood ", lat: 15.775, lon: -85.875, returnPeriod: 10, leadDays: 3, country: "HN" })
        expect(flood).to.deep.equal({
            name: "Aguán river flood", hazard: "flood", source: "GloFAS v4 river discharge via Open-Meteo", lat: 15.775, lon: -85.875,
            returnPeriod: 10, leadDays: 3, unit: "% of ensemble members above the return-period flood", country: "HN"
        })
        const heat = buildMeta({ name: "Karachi", hazard: "heat", lat: 24.9, lon: 67.1, tmax: 42, tmin: 30, days: 2, leadDays: 7 })
        expect(heat.heat).to.deep.equal({ tmax: 42, tmin: 30, days: 2, cells: [[24.9, 67.1]] })
        expect(buildMeta({ name: "Dhaka", hazard: "heat", lat: 23.8, lon: 90.4, tmax: 38, days: 2, leadDays: 7, tmin: "" }).heat).to.not.have.property("tmin")
        const wind = buildMeta({ name: "Tacloban typhoon wind", hazard: "wind", lat: 11.24, lon: 125.0, returnPeriod: 10, leadDays: 5, country: "PH" })
        expect(wind).to.deep.include({ hazard: "wind", returnPeriod: 10, leadDays: 5, wind: { cells: [[11.24, 125.0]] }, unit: "% of ensemble members above the return-period gust" })
        expect(() => buildMeta({ name: "x", hazard: "wind", lat: 1, lon: 1, returnPeriod: 10, leadDays: 20 })).to.throw(/^leadDays/) // GEFS stops at 16 days
        expect(() => buildMeta({ name: "x", hazard: "quake", lat: 1, lon: 1, returnPeriod: 10, leadDays: 5 })).to.throw(/^hazard is flood, heat or wind/)
        // 2-of-2 with ECMWF ENS as the independent partner; a river forecast cannot "confirm" a cyclone, and ECMWF stops at 14 days.
        const pair = buildMeta({ name: "Beira", hazard: "wind", lat: -19.83, lon: 34.84, returnPeriod: 10, leadDays: 5, oracles: ["0xA", "0xB"], pipelines: ["wind", "wind-ecmwf"] })
        expect(pair.pipelines).to.deep.equal({ "0xA": "wind", "0xB": "wind-ecmwf" })
        expect(pair.source).to.match(/\+ ECMWF IFS ENS$/)
        expect(() => buildMeta({ name: "x", hazard: "wind", lat: 1, lon: 1, returnPeriod: 10, leadDays: 5, oracles: ["0xA", "0xB"], pipelines: ["wind", "glofas"] })).to.throw(/^pipelines needs one of wind\|wind-ecmwf per oracle for a wind program/)
        expect(() => buildMeta({ name: "x", hazard: "heat", lat: 1, lon: 1, tmax: 38, days: 2, leadDays: 15, oracles: ["0xA", "0xB"], pipelines: ["heat", "heat-ecmwf"] })).to.throw(/^leadDays must be a number from 1 to 14 with an ECMWF oracle/)
        expect(() => buildMeta({ name: "x", lat: 1, lon: 200, returnPeriod: 5, leadDays: 5 })).to.throw(/^lon must be/)
        expect(() => buildMeta({ name: "x", hazard: "heat", lat: 1, lon: 1, tmax: 42, days: 2, leadDays: 20 })).to.throw(/^leadDays/) // GEFS stops at 16 days
        expect(() => buildMeta({ name: "", lat: 1, lon: 1, returnPeriod: 5, leadDays: 5 })).to.throw(/^name/)
        expect(() => buildMeta({ name: "x", lat: 1, lon: 1, returnPeriod: 5, leadDays: 5, country: "Uganda" })).to.throw(/^country/)
        const two = buildMeta({ name: "x", lat: 5.55, lon: 95.32, returnPeriod: 5, leadDays: 10, oracles: ["0xA", "0xB"], pipelines: ["glofas", "rain"], rainReturnPeriod: 2 })
        expect(two.pipelines).to.deep.equal({ "0xA": "glofas", "0xB": "rain" })
        expect(two.rain).to.deep.equal({ returnPeriod: 2, cells: [[5.55, 95.32]] })
        expect(() => buildMeta({ name: "x", lat: 1, lon: 1, returnPeriod: 5, leadDays: 5, oracles: ["0xA"], pipelines: ["glofas", "rain"] })).to.throw(/^pipelines/)
    })

    it("every preset is a complete, valid trigger with its published source", () => {
        for (const p of PRESETS) {
            expect(p.source).to.match(/^https:\/\//)
            expect(p.trigger).to.be.within(1, 100)
            expect(() => buildMeta({ name: p.label, lat: 1, lon: 1, ...p })).to.not.throw()
        }
    })

    it("snaps to the cell with the most water, not the cell under the town", async () => {
        const real = global.fetch
        let asked
        global.fetch = async (url) => {
            asked = url
            const lats = new URL(url).searchParams.get("latitude").split(","), lons = new URL(url).searchParams.get("longitude").split(",")
            // A main channel 0.05° east of the town, a side stream under it, nothing elsewhere.
            const flow = (la, lo) => (la === "1.000" && lo === "30.050" ? [400, 600] : la === "1.000" && lo === "30.000" ? [20, 30] : [null, 0])
            return { ok: true, json: async () => lats.map((la, i) => ({ latitude: Number(la), longitude: Number(lons[i]), daily: { river_discharge: flow(la, lons[i]) } })) }
        }
        try {
            const c = await riverCell(1, 30)
            expect(c).to.include({ lat: 1, lon: 30.05, flow: 500 })
            expect(c.km).to.be.closeTo(5.56, 0.05)
            expect(asked).to.match(/past_days=92&/) // ~160 of Open-Meteo's free calls for 25 cells, not ~650
        } finally {
            global.fetch = real
        }
    })
})

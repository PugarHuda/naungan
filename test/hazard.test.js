const { expect } = require("chai")
const { annualMaxima, returnLevel, exceedance, rolling, assessRain, episodes, agree, longestRun, assessHeat, replayHeat } = require("../lib/hazard")

describe("hazard (GloFAS trigger math)", () => {
    it("takes yearly peaks from complete years only", () => {
        const time = [], values = []
        for (let d = 0; d < 365 * 2 + 10; d++) {
            const t = new Date(Date.UTC(2020, 0, 1) + d * 864e5).toISOString().slice(0, 10)
            time.push(t)
            values.push(t.startsWith("2020") ? 100 : t.startsWith("2021") ? 300 : 9999)
        }
        values[40] = null
        expect(annualMaxima(time, values)).to.deep.equal([100, 300]) // 2022 has 10 days: dropped
    })

    it("fits a Gumbel return level that grows with the return period", () => {
        const maxima = [500, 620, 700, 710, 760, 800, 850, 900, 1000, 1200, 1475]
        const rp2 = returnLevel(maxima, 2), rp5 = returnLevel(maxima, 5), rp20 = returnLevel(maxima, 20)
        expect(rp2).to.be.lessThan(rp5)
        expect(rp5).to.be.lessThan(rp20)
        // Gumbel median sits just below the mean (mean - 0.1643 * sd * sqrt(6)/pi * ... ≈ 818 here)
        expect(rp2).to.be.closeTo(816, 5)
        expect(() => returnLevel([1, 2, 3], 5)).to.throw(/10 years/)
    })

    it("counts ensemble members whose peak exceeds the threshold", () => {
        const members = [[1, 5, 2], [1, 2, 3], [9, null, 1], [0, 0, 0]]
        expect(exceedance(members, 4)).to.deep.equal({ over: 2, members: 4, probability: 50 })
    })

    it("sums rolling windows and refuses windows with a missing day", () => {
        expect(rolling([1, 2, 3, 4], 2)).to.deep.equal([null, 3, 5, 7])
        expect(rolling([1, null, 3, 4, 5], 2)).to.deep.equal([null, null, null, 7, 9])
    })

    it("rain trigger averages the catchment cells before comparing each GEFS member", async () => {
        // 12 years, 2 cells: each year's wettest 2-day spell is 100 + 10*year in cell A and half that in B.
        const time = [], a = [], b = []
        for (let y = 2000; y < 2012; y++)
            for (let d = 0; d < 365; d++) {
                time.push(`${y}-01-01`)
                const wet = d === 100 || d === 101 ? (100 + 10 * (y - 2000)) / 2 : 0
                a.push(wet), b.push(wet / 2)
            }
        const real = global.fetch
        global.fetch = async (url) => ({
            ok: true,
            json: async () => url.includes("archive")
                ? [{ daily: { time, precipitation_sum: a } }, { daily: { time, precipitation_sum: b } }]
                // GEFS, 2 cells × 2 members over 2 days: member01 drowns cell A only, member02 is dry.
                : [{ latitude: 1, longitude: 1, daily: { time: ["t0", "t1"], precipitation_sum_member01: [400, 400], precipitation_sum_member02: [1, 1] } },
                   { latitude: 1, longitude: 1, daily: { time: ["t0", "t1"], precipitation_sum_member01: [0, 0], precipitation_sum_member02: [1, 1] } }]
        })
        try {
            const r = await assessRain({ leadDays: 2, rain: { returnPeriod: 2, cells: [[0, 0], [0, 1]] } })
            // Catchment maxima are 75..157.5 mm; member01 averages 400 mm, member02 2 mm.
            expect(r.threshold).to.be.within(75, 157.5)
            expect(r).to.include({ over: 1, members: 2, probability: 50, years: 12 })
            expect(r.evidence).to.match(/catchment mean of 2 cells/)
        } finally {
            global.fetch = real
        }
    })

    it("a heatwave is a run of consecutive days strictly above the temperature, broken by a cooler or missing day", () => {
        expect(longestRun([37, 38.5, 39, 37.9, 40, 41, 42], 38)).to.equal(3)
        expect(longestRun([38, 38, 38], 38)).to.equal(0) // "above 38 °C", as the Bangladesh Red Crescent protocol reads
        expect(longestRun([39, null, 39], 38)).to.equal(1)
    })

    it("heat trigger counts the GEFS members that forecast the heatwave, and replays ERA5 the same way", async () => {
        const real = global.fetch
        global.fetch = async (url) => ({
            ok: true,
            json: async () => url.includes("archive")
                ? { daily: { time: ["2024-04-19", "2024-04-20", "2024-04-21"], temperature_2m_max: [39.0, 39.8, 37.5] } }
                // 3 members over 4 days: member01 has two hot days in a row, member02 two separate hot days, member03 none.
                : { latitude: 23.75, longitude: 90.5, daily: { time: ["d0", "d1", "d2", "d3"], temperature_2m_max: [36, 37, 36, 35],
                    temperature_2m_max_member01: [37, 38.4, 39.1, 36], temperature_2m_max_member02: [38.5, 37, 38.6, 36] } }
        })
        try {
            const m = { lat: 23.81, lon: 90.41, leadDays: 4, heat: { tmax: 38, days: 2 } }
            const r = await assessHeat(m)
            expect(r).to.include({ over: 1, members: 3, probability: 33, threshold: 38 })
            expect(r.evidence).to.match(/^NOAA GEFS 0\.25 max temperature .*heatwave = 2\+ days above 38 C \| 1\/3 members/)
            const past = await replayHeat({ ...m, leadDays: 3, date: "2024-04-19" })
            expect(past.probability).to.equal(100)
            expect(past.evidence).to.match(/^REPLAY of ERA5 observed max temperature .*window 2024-04-19\.\.2024-04-21 \| 2 consecutive days above 38 C, hottest 39\.8 C/)
        } finally {
            global.fetch = real
        }
    })

    it("the dashboard re-check reads which pipeline, run and replay window produced a report", async () => {
        const { parseEvidence } = await import("../web/src/verify.mjs")
        expect(parseEvidence("GloFAS v4 via Open-Meteo | cell 5.575,95.325 | run 2026-10-18 | lead 10d")).to.deep.equal({ pipeline: "glofas", replay: null, run: "2026-10-18" })
        expect(parseEvidence("NOAA GEFS 0.25 rainfall via Open-Meteo | catchment mean of 5 cells | run 2026-10-17")).to.deep.equal({ pipeline: "rain", replay: null, run: "2026-10-17" })
        expect(parseEvidence("REPLAY of GloFAS v4 reanalysis via Open-Meteo (not a live forecast) | cell 1,2 | window 2025-11-20..2025-11-29")).to.include({ pipeline: "glofas", replay: "2025-11-20" })
        expect(parseEvidence("REPLAY of ERA5 observed rainfall via Open-Meteo (not a live forecast) | window 2025-11-20..2025-11-29")).to.include({ pipeline: "rain", replay: "2025-11-20" })
        expect(parseEvidence("NOAA GEFS 0.25 max temperature via Open-Meteo | mean of 1 cells | run 2026-10-19 | lead 7d")).to.deep.equal({ pipeline: "heat", replay: null, run: "2026-10-19" })
        expect(parseEvidence("REPLAY of ERA5 observed max temperature via Open-Meteo (not a live forecast) | mean of 1 cells | window 2024-04-15..2024-04-21")).to.include({ pipeline: "heat", replay: "2024-04-15" })
        expect(parseEvidence("trust me, 99%")).to.equal(null)
    })

    it("track record: merges a flood's days into one episode and finds where two oracles agree", () => {
        const time = ["2000-01-01", "2000-01-02", "2000-01-05", "2000-01-20", "2000-03-01", "2000-03-02"]
        const river = [500, 1200, 1100, 1300, null, 990]
        const ep = episodes(time, river, 1000)
        // 1-2 and 1-5 are 3 days apart (one flood), 1-20 is 15 days later (a second one); null never counts
        expect(ep).to.deep.equal([
            { start: "2000-01-02", end: "2000-01-05", peak: 1200, peakDate: "2000-01-02" },
            { start: "2000-01-20", end: "2000-01-20", peak: 1300, peakDate: "2000-01-20" }
        ])
        const rain = [{ start: "2000-01-08", end: "2000-01-09" }, { start: "2000-06-01", end: "2000-06-02" }]
        expect(agree(ep, rain, 10).map((e) => e.start)).to.deep.equal(["2000-01-02"]) // rain on 1-08 is within 10 days of the first flood, 11 days before the second
    })
})

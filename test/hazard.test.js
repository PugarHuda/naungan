const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { annualMaxima, returnLevel, exceedance, rolling, assessRain, episodes, agree, longestRun, assessHeat, replayHeat, floodThreshold, assessWind, replayWind, windHistory, PIPELINES, defaultPipeline } = require("../lib/hazard.mjs")

// Open-Meteo ensemble metadata: the run being served (2026-10-21 06Z), unless a test swaps it.
let RUN = () => ({ last_run_initialisation_time: 1792562400 })

describe("hazard (GloFAS trigger math)", () => {
    // Climatologies are cached on disk (lib/hazard.mjs memo): keep this suite's stubbed ones out of the real cache.
    let dir
    before(() => (process.env.HAZARD_CACHE = dir = fs.mkdtempSync(path.join(os.tmpdir(), "hazard-"))))
    after(() => (delete process.env.HAZARD_CACHE, fs.rmSync(dir, { recursive: true, force: true })))

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
            json: async () => url.includes("meta.json") ? RUN(url)
                : url.includes("archive")
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
        // Karachi's rule also needs warm nights: the cool second night breaks the run.
        expect(longestRun([43, 44, 45], 42, [31, 29, 32], 30)).to.equal(1)
        expect(longestRun([43, 44, 45], 42, [31, 30.5, 32], 30)).to.equal(3)
    })

    it("heat trigger counts the GEFS members that forecast the heatwave, and replays ERA5 the same way", async () => {
        const real = global.fetch
        global.fetch = async (url) => ({
            ok: true,
            json: async () => url.includes("meta.json") ? RUN(url)
                : url.includes("archive")
                ? { daily: { time: ["2024-04-19", "2024-04-20", "2024-04-21"], temperature_2m_max: [39.0, 39.8, 37.5], temperature_2m_min: [27, 28, 26] } }
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

    it("cyclone wind trigger: GEFS members above the place's own 1-in-T-year ERA5 gust, replayed the same way", async () => {
        // 12 years of ERA5 daily peak gusts: calm 40 km/h days, one storm a year of 80 + 5·year km/h.
        const time = [], gust = []
        for (let y = 2000; y < 2012; y++) for (let d = 0; d < 365; d++) time.push(`${y}-${String(1 + Math.floor(d / 31)).padStart(2, "0")}-01`), gust.push(d === 200 ? 80 + 5 * (y - 2000) : 40)
        const real = global.fetch
        global.fetch = async (url) => ({
            ok: true,
            json: async () => url.includes("meta.json") ? RUN(url)
                : !url.includes("archive")
                // GEFS, 3 members over 3 days: member01 brings a 150 km/h gust, member02 and the control stay calm.
                ? { latitude: 11.25, longitude: 125, daily: { time: ["d0", "d1", "d2"], wind_gusts_10m_max: [30, 35, 40], wind_gusts_10m_max_member01: [40, 150, 60], wind_gusts_10m_max_member02: [30, 50, 45] } }
                : url.includes("start_date=2013-11-07")
                ? { daily: { time: ["2013-11-07", "2013-11-08", "2013-11-09"], wind_gusts_10m_max: [95.4, 124.2, 54] } }
                : { daily: { time, wind_gusts_10m_max: gust } }
        })
        try {
            const m = { hazard: "wind", lat: 11.24, lon: 125.0, leadDays: 3, returnPeriod: 10 }
            const r = await assessWind(m)
            expect(r.threshold).to.be.within(120, 150) // storms of 80..135 km/h: the 1-in-10-year gust sits near the top
            expect(r).to.include({ over: 1, members: 3, probability: 33, years: 12 })
            expect(r.evidence).to.match(/^NOAA GEFS 0\.25 wind gusts via Open-Meteo .*1-in-10y gust \d+ km\/h \(Gumbel, 12y ERA5\) \| 1\/3 members exceed \| median strongest gust 50 km\/h$/) // member peaks 40, 150, 50
            const past = await replayWind({ ...m, date: "2013-11-07" })
            expect(past.evidence).to.match(/^REPLAY of ERA5 observed wind gusts .*window 2013-11-07\.\.2013-11-09 \| peak gust 124 km\/h on 2013-11-08/)
            expect(past.probability).to.equal(124.2 > past.threshold ? 100 : 0)
            const h = await windHistory(m)
            expect(h.unit).to.equal("km/h")
            expect(h.episodes.every((e) => e.peak > h.threshold)).to.equal(true)
            // The oracle and the in-browser audit dispatch through one table; a wind program runs the wind pipeline by default.
            expect(PIPELINES.wind).to.deep.equal([assessWind, replayWind])
            expect([defaultPipeline(m), defaultPipeline({ hazard: "heat" }), defaultPipeline({})]).to.deep.equal(["wind", "heat", "glofas"])
            // The 2-of-2 partner reads ECMWF ENS, not GEFS: another agency's model, named in its own evidence.
            let asked = []
            const stub = global.fetch
            global.fetch = async (url) => (asked.push(url), stub(url))
            const e = await PIPELINES["wind-ecmwf"][0](m)
            expect(asked.some((u) => /models=ecmwf_ifs025/.test(u)) && !asked.some((u) => /models=gfs025/.test(u))).to.equal(true)
            expect(e.evidence).to.match(/^ECMWF IFS 0\.25 ENS wind gusts via Open-Meteo .*1\/3 members exceed/)
            expect(PIPELINES["wind-ecmwf"][1]).to.equal(replayWind) // a replay reads observed ERA5 whichever model runs live
            // Each live reading names its model run by the hour (four runs a day), from that model's own metadata.
            expect(r.evidence).to.include("| run 2026-10-21T06Z |")
            expect(asked.some((u) => u.includes("/data/ecmwf_ifs025_ensemble/static/meta.json"))).to.equal(true)
            // A new run lands while the forecast is read: the reading is taken again under the new run, never labelled with the old one.
            let n = 0
            RUN = () => ({ last_run_initialisation_time: n++ === 0 ? 1792562400 : 1792584000 })
            asked = []
            const again = await assessWind(m)
            expect(again.evidence).to.include("| run 2026-10-21T12Z |")
            expect(asked.filter((u) => /models=gfs025/.test(u))).to.have.length(2)
        } finally {
            global.fetch = real
            RUN = () => ({ last_run_initialisation_time: 1792562400 })
        }
    })

    it("the dashboard re-check reads which pipeline, run and replay window produced a report", async () => {
        const { parseEvidence } = await import("../web/src/shared/verify.mjs")
        expect(parseEvidence("GloFAS v4 via Open-Meteo | cell 5.575,95.325 | run 2026-10-18 | lead 10d")).to.deep.equal({ pipeline: "glofas", replay: null, run: "2026-10-18" })
        expect(parseEvidence("NOAA GEFS 0.25 rainfall via Open-Meteo | catchment mean of 5 cells | run 2026-10-17")).to.deep.equal({ pipeline: "rain", replay: null, run: "2026-10-17" })
        expect(parseEvidence("REPLAY of GloFAS v4 reanalysis via Open-Meteo (not a live forecast) | cell 1,2 | window 2025-11-20..2025-11-29")).to.include({ pipeline: "glofas", replay: "2025-11-20" })
        expect(parseEvidence("REPLAY of ERA5 observed rainfall via Open-Meteo (not a live forecast) | window 2025-11-20..2025-11-29")).to.include({ pipeline: "rain", replay: "2025-11-20" })
        expect(parseEvidence("NOAA GEFS 0.25 max temperature via Open-Meteo | mean of 1 cells | run 2026-10-19 | lead 7d")).to.deep.equal({ pipeline: "heat", replay: null, run: "2026-10-19" })
        expect(parseEvidence("REPLAY of ERA5 observed max temperature via Open-Meteo (not a live forecast) | mean of 1 cells | window 2024-04-15..2024-04-21")).to.include({ pipeline: "heat", replay: "2024-04-15" })
        expect(parseEvidence("NOAA GEFS 0.25 wind gusts via Open-Meteo | mean of 1 cells | run 2026-10-21 | lead 5d")).to.deep.equal({ pipeline: "wind", replay: null, run: "2026-10-21" })
        expect(parseEvidence("REPLAY of ERA5 observed wind gusts via Open-Meteo (not a live forecast) | mean of 1 cells | window 2013-11-07..2013-11-11")).to.include({ pipeline: "wind", replay: "2013-11-07" })
        expect(parseEvidence("ECMWF IFS 0.25 ENS wind gusts via Open-Meteo | mean of 1 cells | run 2026-10-21T06Z | lead 5d")).to.deep.equal({ pipeline: "wind-ecmwf", replay: null, run: "2026-10-21T06Z" })
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

    it("an oracle fetches a climatology once a year, not once a run: Node keeps it in HAZARD_CACHE", async () => {
        const real = globalThis.fetch
        const time = [], river_discharge = []
        for (let d = 0; d < 365 * 30; d++) time.push(new Date(Date.UTC(1990, 0, 1) + d * 864e5).toISOString().slice(0, 10)), river_discharge.push(100 + (d % 365) + (d % 997))
        let calls = 0
        globalThis.fetch = async () => (calls++, { ok: true, json: async () => ({ latitude: 1, longitude: 2, daily: { time, river_discharge } }) })
        try {
            const m = { lat: 1.234, lon: 2.345, returnPeriod: 5 }
            const first = await floodThreshold(m), again = await floodThreshold(m)
            expect(calls).to.equal(1)
            expect(again).to.deep.equal(first)
            expect(fs.readdirSync(dir).filter((x) => x.includes("glofas"))).to.have.length(1)
            await floodThreshold({ ...m, returnPeriod: 10 }) // another return period is another key
            expect(calls).to.equal(2)
        } finally {
            globalThis.fetch = real
        }
    })
})

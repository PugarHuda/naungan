const { expect } = require("chai")
const { annualMaxima, returnLevel, exceedance, rolling, assessRain } = require("../lib/hazard")

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
})

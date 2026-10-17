const { expect } = require("chai")
const { annualMaxima, returnLevel, exceedance } = require("../lib/hazard")

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
})

import { describe, expect, it } from "vitest"
import { season, usdOf, type Measured, type Prices } from "./costs"

// Gas measured on Base Sepolia on 22 Oct 2026 (claims ~350k, reports ~57k, enrolment ~215k for a batch), Base mainnet at 0.006 gwei, ETH at $2,438.
const m: Measured = {
    claim: { gas: 349_000n, l1: 2_030_692_871n, n: 3 },
    report: { gas: 56_900n, l1: 1_348_657_954n, n: 3 },
    enroll: { gas: 72_000n, l1: 248_490_334n, n: 3 },
    fund: undefined
}
const p: Prices = { gasPrice: 6_000_000n, ethUsd: 2438.45, at: 0 }

describe("running costs", () => {
    it("prices one action as gas × mainnet gas price plus its L1 data fee, in USD", () => {
        expect(usdOf(m.claim!, p)).toBeCloseTo(((349_000 * 6e6 + 2_030_692_871) / 1e18) * 2438.45, 12)
        expect(usdOf(m.claim!, p)).toBeLessThan(0.01) // half a US cent to claim on Base today
    })

    it("a two-oracle program serving 1,000 households: a year of reports plus enrolling and paying each, as a share of the aid", () => {
        const s = season(m, p, 2, 1000, 50)
        expect(s.reports).toBeCloseTo(2 * 4 * 365 * usdOf(m.report!, p), 9)
        expect(s.delivery).toBeCloseTo(1000 * (usdOf(m.enroll!, p) + usdOf(m.claim!, p)), 9)
        expect(s.total).toBeCloseTo(s.reports + s.delivery, 9)
        expect(s.share).toBeLessThan(0.001) // under 0.1% of $50,000 paid
    })

    it("an empty program costs its reports and divides by nothing", () => {
        const s = season({ ...m, claim: undefined, enroll: undefined }, p, 1, 0, 1)
        expect(s.delivery).toBe(0)
        expect(s.perHousehold).toBe(0)
        expect(s.share).toBe(0)
    })
})

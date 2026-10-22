import { describe, expect, it } from "vitest"
import { statement, type Move, type Pool } from "./statement"

const gift = (programId: number, amount: bigint, block: number): Move => ({ programId, amount, tx: `0x${block}`, block, index: 0, at: 1_790_000_000 + block })

describe("donor statement", () => {
    // Program 2 as on Base Sepolia: 3 USDC from one donor, 1 USDC a household, 2 claims.
    const live = new Map<number, Pool>([[2, { amountPerHousehold: 1_000_000n, funded: 3_000_000n, claims: 2n, over: false }]])

    it("a sole donor paid for every claim, and the rest waits in the pool", () => {
        const [l] = statement([gift(2, 3_000_000n, 1)], [], live)
        expect(l).toMatchObject({ gave: 3_000_000n, paid: 2_000_000n, households: 2, left: 1_000_000n, state: "pool" })
    })

    it("shares a pool pro rata, and once claims are over offers exactly what refund() pays, floored", () => {
        // Another donor gave 2 of the 3 USDC: this one paid for a third of the claims.
        const pools = new Map<number, Pool>([[5, { amountPerHousehold: 1_000_000n, funded: 3_000_000n, claims: 1n, over: true }]])
        const [l] = statement([gift(5, 1_000_000n, 1)], [], pools)
        expect(l.paid).toBe(333_333n)
        expect(l.households).toBeCloseTo(0.333, 3)
        expect(l.state).toBe("refundable")
        expect(l.left).toBe((1_000_000n * (3_000_000n - 1_000_000n)) / 3_000_000n) // the contract's own formula
        expect(l.paid + l.left).toBeLessThanOrEqual(l.gave) // never more than was given
    })

    it("adds gifts per program in chain order, and a refund leaves nothing to take back", () => {
        const pools = new Map<number, Pool>([
            [3, { amountPerHousehold: 500_000n, funded: 2_000_000n, claims: 0n, over: true }],
            [4, { amountPerHousehold: 500_000n, funded: 80_000n, claims: 0n, over: false }]
        ])
        const out = statement([gift(4, 80_000n, 9), gift(3, 1_500_000n, 7), gift(3, 500_000n, 2)], [gift(3, 2_000_000n, 20)], pools)
        expect(out.map((l) => l.programId)).toEqual([3, 4])
        expect(out[0].gifts.map((g) => g.block)).toEqual([2, 7])
        expect(out[0]).toMatchObject({ gave: 2_000_000n, refunded: 2_000_000n, left: 0n, state: "refunded" })
        expect(out[1]).toMatchObject({ gave: 80_000n, paid: 0n, left: 80_000n, state: "pool" })
    })

    it("refuses to guess when a pool's state is missing", () => {
        expect(() => statement([gift(7, 1n, 1)], [], new Map())).toThrow(/program #7/)
    })
})

import { describe, expect, it, vi } from "vitest"
import { currencyOf, languageOf, flagOf, localMoney, placeOf, type Rates } from "./place"
import { compare, type GoEvent } from "./ifrc"
import { isOver, parseMeta, type Program } from "./chain"
import { canBatch, batchOutcome } from "./wallet"

describe("place", () => {
    it("looks a shared point up once for every card, and tries a failed lookup once more", async () => {
        let calls = 0
        vi.stubGlobal("fetch", async () => {
            if (calls++ === 0) throw new TypeError("Failed to fetch") // the free geocoder dropped one request
            return { json: async () => ({ countryCode: "ID", countryName: "Indonesia", continent: "Asia" }) }
        })
        const four = await Promise.all([1, 2, 3, 4].map(() => placeOf(5.575, 95.325)))
        vi.unstubAllGlobals()
        expect(four.map((p) => p?.code)).toEqual(["ID", "ID", "ID", "ID"])
        expect(calls).toBe(2)
    }, 10e3)
    it("maps countries to currencies and likely languages", () => {
        expect([currencyOf("BD"), currencyOf("ID"), currencyOf("HN"), currencyOf("UG"), currencyOf("US"), currencyOf(undefined)]).toEqual(["BDT", "IDR", "HNL", "UGX", "USD", undefined])
        expect([languageOf("BD"), languageOf("HN"), languageOf("ID"), languageOf("UG"), languageOf("KE")]).toEqual(["bn", "es", "id", "sw", "sw"])
    })
    it("draws flags from regional indicators, nothing for bad codes", () => {
        expect(flagOf("ID")).toBe("🇮🇩")
        expect(flagOf("id")).toBe("")
        expect(flagOf(undefined)).toBe("")
    })
    // Intl separates symbol and amount with a no-break space; compare with plain spaces.
    const money = (...a: Parameters<typeof localMoney>) => localMoney(...a)?.text.replace(/\s/g, " ")
    it("shows local money, rounding big-number currencies to whole units", () => {
        const fx: Rates = { rates: { BDT: 124.2, IDR: 18055.4, HNL: 26.1, UGX: 4030, KWD: 0.307 }, day: Date.UTC(2026, 9, 20), at: 0 }
        expect(money(1, "BD", fx, "en-BD")).toBe("≈ BDT 124")
        expect(money(1, "ID", fx, "id-ID")).toBe("≈ Rp 18.055")
        expect(money(0.5, "HN", fx, "es-HN")).toBe("≈ L 13")
        expect(money(0.5, "UG", fx, "en-UG")).toBe("≈ USh 2,015")
        expect(money(1, "KW", fx, "en")).toMatch(/0\.31$/) // under 10 a unit: keep two decimals
        expect(localMoney(1, "UG", fx, "en")?.currency).toBe("Ugandan Shilling")
    })
    it("shows nothing for dollar countries or unknown rates", () => {
        const fx: Rates = { rates: { BDT: 124 }, day: 0, at: 0 }
        expect(localMoney(1, "US", fx, "en")).toBeNull()
        expect(localMoney(1, "EC", fx, "en")).toBeNull() // Ecuador uses the US dollar
        expect(localMoney(1, "HN", fx, "en")).toBeNull()
        expect(localMoney(1, "BD", null, "en")).toBeNull()
        expect(localMoney(1, undefined, fx, "en")).toBeNull()
    })
})

describe("IFRC comparison", () => {
    const ev = (start: string): GoEvent => ({ id: 1, name: start, start, affected: null, appeals: [], url: "" })
    const paid = [{ start: "2020-07-01", end: "2020-07-10" }]
    it("catches an event within the window on either side of a payout, not beyond it", () => {
        const r = compare([ev("2020-06-01"), ev("2020-05-31"), ev("2020-08-09"), ev("2020-08-10"), ev("2020-07-05")], paid, "2000-01-01", "2025-12-31", 30)
        expect(r.rows.map((x) => [x.start, x.caught])).toEqual([["2020-06-01", true], ["2020-05-31", false], ["2020-08-09", true], ["2020-08-10", false], ["2020-07-05", true]])
        expect([r.caught, r.total]).toEqual([3, 5])
    })
    it("ignores events outside the record's years", () => {
        const r = compare([ev("1990-01-01"), ev("2026-03-01"), ev("2020-07-02")], paid, "1997-01-01", "2025-12-31")
        expect(r.total).toBe(1)
        expect(r.caught).toBe(1)
    })
})

describe("chain helpers", () => {
    const p = (claimDeadline: number, seasonEnd: number) => ({ claimDeadline: BigInt(claimDeadline), seasonEnd: BigInt(seasonEnd) }) as Program
    it("claims are over after the window, or after an untriggered season, like Naungan.closed()", () => {
        expect(isOver(p(0, 1000), 999)).toBe(false)
        expect(isOver(p(0, 1000), 1001)).toBe(true)
        expect(isOver(p(500, 1000), 499)).toBe(false)
        expect(isOver(p(500, 1000), 501)).toBe(true) // a fired program is over at its deadline, not the season end
    })
    it("reads metadata, and anything that is not a JSON object as an unnamed program", () => {
        expect(parseMeta('{"name":"Jamuna","lat":25.18}')).toEqual({ name: "Jamuna", lat: 25.18 })
        expect(parseMeta("not json")).toEqual({})
        expect(parseMeta("null")).toEqual({})
        expect(parseMeta("42")).toEqual({})
    })
})

describe("EIP-5792 batched calls", () => {
    it("batches only where the wallet says atomic calls work on our chain (v2 or v1 shape, or every chain)", () => {
        expect(canBatch({ "0x14a34": { atomic: { status: "supported" } } }, "0x14a34")).toBe(true)
        expect(canBatch({ "0x14a34": { atomic: { status: "ready" } } }, "0x14a34")).toBe(true) // EIP-7702 account that upgrades on first use
        expect(canBatch({ "0x14a34": { atomic: { status: "unsupported" } } }, "0x14a34")).toBe(false)
        expect(canBatch({ "0x14a34": { atomicBatch: { supported: true } } }, "0x14a34")).toBe(true)
        expect(canBatch({ "0x0": { atomic: { status: "supported" } } }, "0x14a34")).toBe(true)
        expect(canBatch({ "0x2105": { atomic: { status: "supported" } } }, "0x14a34")).toBe(false) // another chain only
        expect(canBatch(undefined, "0x14a34")).toBe(false)
    })
    it("reads the batch status: pending, the hash once landed, an error when it failed or reverted", () => {
        expect(batchOutcome({ status: 100 })).toBeNull()
        expect(batchOutcome({ status: "PENDING" })).toBeNull()
        expect(batchOutcome({ status: 200, receipts: [{ transactionHash: "0xab", status: "0x1" }] })).toBe("0xab")
        expect(batchOutcome({ status: "CONFIRMED", receipts: [{ transactionHash: "0x1" }, { transactionHash: "0x2" }] })).toBe("0x2") // non-atomic v1 wallets: the fund() call is last
        expect(() => batchOutcome({ status: 200, receipts: [{ transactionHash: "0xab", status: "0x0" }] })).toThrow("reverted")
        expect(() => batchOutcome({ status: 500 })).toThrow("reverted")
        expect(() => batchOutcome({ status: 400 })).toThrow("did not send")
        expect(() => batchOutcome({ status: 200, receipts: [] })).toThrow("without a receipt")
    })
})

const { expect } = require("chai")
const { lock, unlock, newPin } = require("../lib/cardlock")

describe("PIN-locked claim cards", () => {
    it("opens only with the right PIN and for the right program", async () => {
        const secret = "mtVmjtzdGv7EMx4T2Z0D8SYEnZbCdUr4+tLEXGL7/LA="
        const pin = newPin()
        expect(pin).to.match(/^[0-9]{6}$/)
        const blob = await lock(secret, pin, 2n)
        expect(blob).to.match(/^[A-Za-z0-9_-]+$/) // URL-fragment safe, no plaintext inside
        expect(blob).to.not.include(secret.slice(0, 8))
        expect(await unlock(blob, pin, 2n)).to.equal(secret)
        const wrong = pin === "000000" ? "000001" : "000000"
        await expect(unlock(blob, wrong, 2n)).to.be.rejected
        await expect(unlock(blob, pin, 3n)).to.be.rejected // another program's card
        await expect(unlock(blob.slice(0, -4) + "AAAA", pin, 2n)).to.be.rejected // tampered
        expect(await lock(secret, pin, 2n)).to.not.equal(blob) // fresh salt and IV every time
    })
})

describe("PIN cards v2: server-checked PIN (OPRF)", () => {
    const { lockV2, unlockV2, oprfKey, evaluate, MAX_TRIES } = require("../lib/cardlock")
    const { parsePin, sharedStore } = require("../scripts/relayer")
    const secret = "mtVmjtzdGv7EMx4T2Z0D8SYEnZbCdUr4+tLEXGL7/LA="

    it("opens only with the right PIN, the right program and the server's key", async () => {
        const seen = [], server = (seed) => async (q) => evaluate(await oprfKey(seed, q.programId, q.card), q.point)
        const ask = async (q) => (seen.push(q), server("relayer-seed")(q))
        const pin = newPin()
        const blob = await lockV2(secret, pin, 2n, ask)
        expect(blob).to.not.include(secret.slice(0, 8))
        expect(await unlockV2(blob, pin, 2n, ask)).to.equal(secret)
        // The server only ever sees a blinded point: never the PIN, and a new point for the same PIN each time.
        expect(JSON.stringify(seen)).to.not.include(pin)
        expect(seen[0].card).to.equal(seen[1].card)
        expect(seen[0].point).to.not.equal(seen[1].point)
        await expect(unlockV2(blob, pin === "000000" ? "000001" : "000000", 2n, ask)).to.be.rejected
        await expect(unlockV2(blob, pin, 3n, ask)).to.be.rejected // another program's card
        // Without the server's key the right PIN is useless: no offline search is possible.
        await expect(unlockV2(blob, pin, 2n, server("another-seed"))).to.be.rejected
        // Naming a made-up card id to get a fresh try counter yields a key for that id: useless here.
        await expect(unlockV2(blob, pin, 2n, async (q) => server("relayer-seed")({ ...q, card: "ab".repeat(16) }))).to.be.rejected
        await expect(unlockV2(blob, pin, 2n, async (q) => server("relayer-seed")({ ...q, programId: "3" }))).to.be.rejected
    })

    it("the server rejects bad points and requests, and counts tries per card", async () => {
        const key = await oprfKey("relayer-seed", "2", "ab".repeat(16))
        expect(() => evaluate(key, "00".repeat(32))).to.throw("identity")
        expect(() => evaluate(key, "ff".repeat(32))).to.throw()
        expect(() => evaluate(key, "zz")).to.throw("32 bytes hex")
        expect(() => parsePin({ programId: 2, card: "ab".repeat(16) })).to.throw("decimal string")
        expect(() => parsePin({ programId: "2", card: "AB".repeat(16) })).to.throw("16 bytes hex")
        const pins = sharedStore({})
        expect(pins.store).to.equal("memory")
        for (let i = 1; i <= MAX_TRIES + 1; i++) expect(await pins.incr("pin:2:a", 60)).to.equal(i)
        expect(await pins.incr("pin:2:b", 60)).to.equal(1) // another card has its own count
    })

    it("the shared store lets exactly one relayer instance submit a given claim", async () => {
        const store = sharedStore({})
        const tries = await Promise.all([1, 2, 3].map(() => store.claim("naungan:relay:claim:4:99", "pending", 300)))
        expect(tries.filter(Boolean)).to.have.length(1) // the rest answer "already being submitted"
        await store.set("naungan:relay:claim:4:99", "0xabc", 60)
        expect(await store.get("naungan:relay:claim:4:99")).to.equal("0xabc") // later copies are told it is spent
        await store.del("naungan:relay:claim:4:99")
        expect(await store.claim("naungan:relay:claim:4:99", "pending", 300)).to.equal(true) // a failed send frees it
        expect(await store.claim("naungan:relay:x", "pending", -1)).to.equal(true)
        expect(await store.claim("naungan:relay:x", "pending", 300)).to.equal(true) // expired entries do not block
    })
})

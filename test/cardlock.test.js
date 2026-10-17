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

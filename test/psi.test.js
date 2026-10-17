const { expect } = require("chai")
const { Agency, privateDedup, soundex } = require("../lib/psi")

describe("private cross-agency dedup (PSI)", () => {
    it("finds the same household across spelling variants without sharing lists", () => {
        const unhcr = new Agency([
            { name: "Fatima Begum", birthYear: 1990, village: "Kamp Lhokseumawe" },
            { name: "Nur Kayas", birthYear: 1985, village: "Kamp Pidie" },
            { name: "Abdul Karim", birthYear: 1979, village: "Kamp Pidie" }
        ])
        const zakat = new Agency([
            { name: "Begum, Fatimah", birthYear: 1990, village: "kamp lhokseumawe" }, // dup, spelled differently
            { name: "Mohammed Rafiq", birthYear: 2001, village: "Kamp Aceh Timur" },
            { name: "Abdul Karim", birthYear: 1980, village: "Kamp Pidie" } // same name, different person
        ])
        expect([...privateDedup(unhcr, zakat)]).to.deep.equal([0])
        expect([...privateDedup(zakat, unhcr)]).to.deep.equal([0])
    })

    it("transcript carries no plaintext and differs per session", () => {
        const recs = [{ name: "Fatima Begum", birthYear: 1990, village: "X" }]
        const a1 = new Agency(recs).request()
        const a2 = new Agency(recs).request()
        expect(a1.join()).to.not.include("fatima")
        expect(a1[0]).to.not.equal(a2[0]) // fresh secret => unlinkable across sessions
    })

    it("soundex groups common transliterations", () => {
        expect(soundex("muhammad")).to.equal(soundex("mohammed"))
        expect(soundex("fatima")).to.equal(soundex("fatimah"))
    })
})

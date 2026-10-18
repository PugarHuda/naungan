const { expect } = require("chai")
const { Agency, privateDedup, soundex, nameTokens } = require("../lib/psi")

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
        const found = privateDedup(unhcr, zakat)
        expect([...found]).to.deep.equal([0])
        expect([...found.near]).to.deep.equal([2]) // namesake one year apart: held for review, not merged
        expect([...privateDedup(zakat, unhcr)]).to.deep.equal([0])
    })

    it("matches Acehnese titles, bin/binti and pre-1972 spelling across registers", () => {
        const gampong = new Agency([
            { name: "Teuku Umar bin Ismail", birthYear: 1972, village: "Gampong Lambaro" },
            { name: "Cut Nyak Fatimah", birthYear: 1988, village: "Gampong Lambaro" },
            { name: "Tgk. Djamaluddin", birthYear: 1961, village: "Gampong Lampeuneurut" },
            { name: "Syarifah Aini", birthYear: 1995, village: "Gampong Lambaro" }
        ])
        const ngo = new Agency([
            { name: "T. Oemar Ismail", birthYear: 1972, village: "gampong lambaro" },
            { name: "Nyak Fatimah", birthYear: 1988, village: "Gampong Lambaro" },
            { name: "Jamaluddin", birthYear: 1961, village: "Gampong Lampeuneurut" },
            { name: "Syarifah Aini", birthYear: 1975, village: "Gampong Lambaro" } // different person
        ])
        const found = privateDedup(gampong, ngo)
        expect([...found].sort()).to.deep.equal([0, 1, 2])
        expect(found.near.size).to.equal(0)
        expect(nameTokens("Hj. Siti binti Abdullah")).to.deep.equal(["abdullah", "siti"])
    })

    it("rejects a reply that does not line up with the request", () => {
        const a = new Agency([{ name: "Nur", birthYear: 1990, village: "X" }])
        const reply = new Agency([{ name: "Nur", birthYear: 1990, village: "X" }]).respond(a.request())
        expect(() => a.intersect({ ...reply, doubled: reply.doubled.slice(1) })).to.throw(/different request/)
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

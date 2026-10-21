const { expect } = require("chai")
const { Agency, privateDedup, soundex, nameTokens, recordKeys } = require("../lib/psi.mjs")

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

    it("holds one-letter typos for review, never two-letter ones or another village", () => {
        const a = new Agency([
            { name: "Devi Sartika", birthYear: 1990, village: "Gampong Lambaro" }, // w→v changes Soundex
            { name: "Muryadi Ali", birthYear: 1985, village: "Gampong Lambaro" }, // l→r changes Soundex
            { name: "Jusuf Hasan", birthYear: 1970, village: "Gampong Lambaro" }, // old spelling: a full match
            { name: "Devi Sartika", birthYear: 1991, village: "Gampong Pango" }, // other village
            { name: "Ratni Devi", birthYear: 2000, village: "Gampong Lambaro" } // two edits from "Ratna Dewi"
        ])
        const b = new Agency([
            { name: "Dewi Sartika", birthYear: 1990, village: "Gampong Lambaro" },
            { name: "Mulyadi Ali", birthYear: 1985, village: "Gampong Lambaro" },
            { name: "Yusuf Hasan", birthYear: 1970, village: "Gampong Lambaro" },
            { name: "Ratna Dewi", birthYear: 2000, village: "Gampong Lambaro" }
        ])
        const found = privateDedup(a, b)
        expect([...found]).to.deep.equal([2])
        expect([...found.near].sort()).to.deep.equal([0, 1])
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

    it("works outside Indonesia with the basic name profile, and refuses mixed profiles", () => {
        const a = new Agency([
            { name: "María José García", birthYear: 1984, village: "San Pedro Sula" },
            { name: "Jan Novak", birthYear: 1990, village: "Brno" },
            { name: "Dr. Amina Okafor", birthYear: 1979, village: "Maiduguri" }
        ], { profile: "basic" })
        const b = new Agency([
            { name: "Maria Jose Garcia", birthYear: 1984, village: "san pedro sula" }, // accents dropped by one register
            { name: "Yan Novak", birthYear: 1990, village: "Brno" }, // another person: no j/y folding here
            { name: "Amina Okafor", birthYear: 1979, village: "Maiduguri" } // honorific left out
        ], { profile: "basic" })
        expect([...privateDedup(a, b)].sort()).to.deep.equal([0, 2])
        // The Indonesian profile would fold Jan and Yan together; that is right in Aceh, wrong in Brno.
        expect(nameTokens("Jan Novak", undefined, "id")).to.deep.equal(nameTokens("Yan Novak", undefined, "id"))
        expect(nameTokens("Jan Novak", undefined, "basic")).to.not.deep.equal(nameTokens("Yan Novak", undefined, "basic"))
        expect(() => new Agency([], { profile: "xx" })).to.throw(/unknown name profile/)
        // Same record, different profiles: the exact and phonetic keys differ, which is why the service checks the profile.
        const r = { name: "Jusuf Hasan", birthYear: 1970, village: "Lambaro" }
        const main = (p) => recordKeys(r, false, p).filter((x) => !x.near).map((x) => x.k)
        expect(main("basic").filter((k) => main("id").includes(k))).to.have.length(0)
    })
})

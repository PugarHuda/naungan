const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { parseLine, readHouseholds } = require("../lib/csv")
const { parseProof } = require("../scripts/relayer")

describe("services input validation", () => {
    it("parses quoted CSV cells and validates household rows", () => {
        expect(parseLine('"Begum, Fatimah",1990, kamp lhokseumawe ')).to.deep.equal(["Begum, Fatimah", "1990", "kamp lhokseumawe"])
        expect(parseLine('"say ""hi""",x')).to.deep.equal(['say "hi"', "x"])
        expect(() => parseLine('"open,1')).to.throw(/unterminated/)
        const f = path.join(os.tmpdir(), `naungan-${process.pid}.csv`)
        fs.writeFileSync(f, "﻿name,birthYear,village\r\nNur Kayas,1985,Kamp Pidie\r\n")
        expect(readHouseholds(f)).to.deep.equal([{ name: "Nur Kayas", birthYear: 1985, village: "Kamp Pidie" }])
        fs.writeFileSync(f, "name,birthYear,village\nNur Kayas,85x,Kamp Pidie\n")
        expect(() => readHouseholds(f)).to.throw(/row 2/)
        fs.unlinkSync(f)
    })

    it("relayer rejects malformed or mismatched proofs before touching the chain", () => {
        const proof = { merkleTreeDepth: 2, merkleTreeRoot: "1", nullifier: "2", message: "3", scope: "5", points: Array(8).fill("0") }
        expect(parseProof({ programId: "5", proof }).pid).to.equal(5n)
        expect(() => parseProof({ programId: "6", proof })).to.throw(/scope/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, points: [1] } })).to.throw(/malformed/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, merkleTreeDepth: 99 } })).to.throw(/range/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, nullifier: { x: 1 } } })).to.throw(/malformed/)
        expect(() => parseProof(null)).to.throw()
    })
})

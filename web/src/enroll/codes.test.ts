import { describe, expect, it } from "vitest"
import { readCode, codesIn, chunks, FIELD } from "./codes"

const c = "17388438489374373932189263271489829826419432651512983291452931871364981792716"
describe("registration codes", () => {
    it("accepts a code for this program and returns its commitment", () => {
        expect(readCode(`  naungan-commitment:7:${c}\n`, 7n, new Set(), new Set())).toEqual({ ok: true, commitment: c })
    })
    it("refuses other programs, damaged codes, repeats and households already on-chain, saying why", () => {
        const why = (raw: string, have: string[] = [], on: string[] = []) => { const v = readCode(raw, 7n, new Set(have), new Set(on)); return v.ok ? "ok" : v.why }
        expect(why(`naungan-commitment:8:${c}`)).toMatch(/program #8, not #7/)
        expect(why("hello")).toBe("not a Naungan registration code")
        expect(why("0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E")).toBe("not a Naungan registration code") // a wallet QR scanned by mistake
        expect(why("naungan-commitment:7:0")).toMatch(/damaged/)
        expect(why(`naungan-commitment:7:${FIELD}`)).toMatch(/damaged/)
        expect(why(`naungan-commitment:7:${c}`, [c])).toBe("already scanned")
        expect(why(`naungan-commitment:7:${c}`, [], [c])).toBe("already enrolled in this program")
    })
    it("finds every code in pasted lines or CSV cells", () => {
        expect(codesIn(`name,code\nx,"naungan-commitment:7:1"\nnaungan-commitment:7:22 junk\r\nnaungan-commitment:3:5`)).toEqual(["naungan-commitment:7:1", "naungan-commitment:7:22", "naungan-commitment:3:5"])
    })
    it("splits enrollment into transactions of at most 100", () => {
        expect(chunks(Array.from({ length: 250 }, (_, i) => i)).map((x) => x.length)).toEqual([100, 100, 50])
        expect(chunks([])).toEqual([])
    })
})

import { describe, expect, it } from "vitest"
import { P, posterLang } from "./i18n"

describe("registration poster languages", () => {
    for (const lang of Object.keys(P).filter((l) => l !== "en"))
        it(`${lang} is complete and translated`, () => {
            const t = P[lang], en = P.en
            expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort())
            for (const hz of ["flood", "heat", "wind"] as const) {
                expect(t.steps(hz)).toHaveLength(3)
                t.steps(hz).forEach((s, i) => expect(s).not.toBe(en.steps(hz)[i]))
                expect(t.per("2 USDC", hz)).toContain("2 USDC")
                expect(t.per("2 USDC", hz)).not.toContain("undefined")
            }
            expect(t.title).not.toBe(en.title)
            expect(t.privacy).not.toBe(en.privacy)
        })
    it("prints in ?lang=, else English", () => {
        expect(posterLang("es")).toBe("es")
        expect(posterLang("BN")).toBe("bn")
        expect(posterLang("xx")).toBe("en")
        expect(posterLang(null)).toBe("en")
    })
})

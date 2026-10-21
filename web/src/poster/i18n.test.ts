import { describe, expect, it } from "vitest"
import { P, posterLang } from "./i18n"

describe("registration poster languages", () => {
    for (const lang of Object.keys(P).filter((l) => l !== "en"))
        it(`${lang} is complete and translated`, () => {
            const t = P[lang], en = P.en
            expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort())
            for (const heat of [false, true]) {
                expect(t.steps(heat)).toHaveLength(3)
                t.steps(heat).forEach((s, i) => expect(s).not.toBe(en.steps(heat)[i]))
                expect(t.per("2 USDC", heat)).toContain("2 USDC")
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

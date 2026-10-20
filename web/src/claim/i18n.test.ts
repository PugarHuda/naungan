import { describe, expect, it } from "vitest"
import { T, NATIVE, pickLang } from "./i18n"

describe("claim app translations", () => {
    const en = T.en
    for (const lang of Object.keys(T).filter((l) => l !== "en")) {
        it(`${lang} has every English string, of the same kind, none empty`, () => {
            expect(Object.keys(T[lang]).sort()).toEqual(Object.keys(en).sort())
            for (const [k, v] of Object.entries(T[lang])) {
                expect(typeof v, k).toBe(typeof en[k])
                const text = typeof v === "function" ? v(3, 60) : v
                expect(text.trim(), k).not.toBe("")
            }
        })
    }
    it("every language has a name in its own script for the picker", () => {
        expect(Object.keys(NATIVE).sort()).toEqual(Object.keys(T).sort())
    })
})

describe("language priority", () => {
    it("the household's own choice wins", () => expect(pickLang("es", ["bn-BD"], "sw")).toBe("es"))
    it("an unknown saved choice is ignored", () => expect(pickLang("xx", undefined, "bn")).toBe("bn"))
    it("then the phone's language, when we have it", () => expect(pickLang(null, ["fr-FR", "id-ID"], "sw")).toBe("id"))
    it("an English phone lets the program's language win", () => expect(pickLang(null, ["en-US", "en"], "sw")).toBe("sw"))
    it("a country language we lack falls back to English", () => expect(pickLang(null, ["en-GB"], "ur")).toBe("en"))
    it("before the country is known: English", () => expect(pickLang(null, ["en-US"])).toBe("en"))
})

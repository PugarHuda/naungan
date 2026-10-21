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
    it("the household's own choice wins", () => expect(pickLang("bn")).toBe("bn"))
    it("otherwise English, whatever the phone or the program's country", () => expect([pickLang(null), pickLang("xx")]).toEqual(["en", "en"]))
})

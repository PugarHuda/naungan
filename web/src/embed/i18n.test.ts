import { describe, expect, it } from "vitest"
import { E, embedLang } from "./i18n"

// A string, or the text a function entry produces for sample arguments.
const say = (v: unknown) => (typeof v === "function" ? (v as (...a: unknown[]) => string)(true, "1 Jan", 0) : String(v))

describe("embed widget languages", () => {
    for (const lang of Object.keys(E).filter((l) => l !== "en"))
        it(`${lang} has every English string, none empty`, () => {
            expect(Object.keys(E[lang]).sort()).toEqual(Object.keys(E.en).sort())
            for (const [k, v] of Object.entries(E[lang])) {
                const text = say(v), english = say((E.en as unknown as Record<string, unknown>)[k])
                expect(text, `${lang}.${k}`).toMatch(/\S/)
                expect(text, `${lang}.${k} is still English`).not.toBe(english)
            }
        })
    it("follows the partner's ?lang=, else English", () => {
        expect(embedLang("bn")).toBe("bn")
        expect(embedLang("ID")).toBe("id")
        expect(embedLang("xx")).toBe("en")
        expect(embedLang(null)).toBe("en")
    })
})

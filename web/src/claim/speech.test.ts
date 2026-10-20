import { describe, expect, it } from "vitest"
import { T } from "./i18n"
import { speechText, stepOf, pickVoice, type Step } from "./speech"

const strings = (lang: string) => (k: string) => T[lang][k]
const values = { program: "Jamuna flood · Bahadurabad", amount: "1.0", money: "≈ ৳124", status: "Watching the river.", message: "Your card is valid.", canClaim: true }
const STEPS: Step[] = ["nocard", "pin", "program", "join", "paid"]

describe("read-aloud text", () => {
    for (const lang of Object.keys(T)) {
        it(`${lang}: every step speaks, in that language, with no secret`, () => {
            for (const step of STEPS) {
                const text = speechText(step, strings(lang), values)
                expect(text.length, step).toBeGreaterThan(10)
                expect(text, step).not.toMatch(/0x[0-9a-f]{6,}|undefined|null|NaN|\[object/i)
            }
            const program = speechText("program", strings(lang), values)
            expect(program).toContain(T[lang].program as string)
            expect(program).toContain("124")
            expect(program).not.toContain("≈") // read as "about", in the language
            expect(program).toContain(T[lang].about as string)
            expect(program).toContain(T[lang].claim as string) // what to do next names the real button
            expect(speechText("join", strings(lang), values)).toContain(T[lang].joinHow as string)
        })
    }

    it("Bengali stays Bengali, and only offers Claim when the button is there", () => {
        const bn = speechText("program", strings("bn"), { ...values, canClaim: false })
        expect(bn).toMatch(/[ঀ-৿]/)
        expect(bn).not.toContain(T.bn.claim as string)
        expect(speechText("paid", strings("bn"), values)).toBe("পরিশোধিত। 1.0 USDC এখন আপনার ওয়ালেটে আছে।")
        expect(speechText("join", strings("bn"), values)).toMatch(/^নিজের ফোন দিয়ে নিবন্ধন করুন। /)
    })

    it("no local money for dollar countries: no stray 'about'", () => {
        expect(speechText("program", strings("es"), { ...values, money: null })).not.toContain(" unos ")
    })

    it("knows which screen is up, most advanced first", () => {
        const base = { paid: null, join: null, program: false, snap: null, pin: false, nocard: false }
        expect(stepOf(base)).toBe(null)
        expect(stepOf({ ...base, nocard: true })).toBe("nocard")
        expect(stepOf({ ...base, program: true })).toBe(null) // card still loading: nothing to read yet
        expect(stepOf({ ...base, program: true, snap: {} })).toBe("program")
        expect(stepOf({ ...base, program: true, snap: {}, join: {} })).toBe("join")
        expect(stepOf({ ...base, program: true, snap: {}, paid: {} })).toBe("paid")
    })
})

describe("voice choice", () => {
    const voices = [{ lang: "en-US" }, { lang: "bn-IN" }, { lang: "bn-BD" }, { lang: "in_ID" }, { lang: "es-ES" }]
    it("prefers the program country's variant, then any voice of the language", () => {
        expect(pickVoice(voices, "bn", "BD")?.lang).toBe("bn-BD")
        expect(pickVoice(voices, "bn")?.lang).toBe("bn-IN")
        expect(pickVoice(voices, "es", "HN")?.lang).toBe("es-ES")
    })
    it("reads Indonesian with old Android's in-ID voice", () => expect(pickVoice(voices, "id", "ID")?.lang).toBe("in_ID"))
    it("never reads a language with another language's voice", () => {
        expect(pickVoice(voices, "sw", "UG")).toBe(null)
        expect(pickVoice([{ lang: "en-GB" }], "bn")).toBe(null)
    })
})

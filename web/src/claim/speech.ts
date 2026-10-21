// Read-aloud for households who read with difficulty: the screen's message, spoken by the phone's own
// speech engine (Web Speech API, no server, nothing sent anywhere). Built from the same translated strings
// the screen shows. Card secrets, backup keys and wallet addresses are never passed in, so never spoken.

export type Step = "nocard" | "pin" | "program" | "join" | "paid"

/** The screen the household is on, most advanced first (a paid card also shows its program card). */
export function stepOf(ui: { paid: unknown; join: unknown; program: boolean; snap: unknown; pin: boolean; nocard: boolean }): Step | null {
    return ui.paid ? "paid" : ui.join ? "join" : ui.program && ui.snap ? "program" : ui.pin ? "pin" : ui.nocard ? "nocard" : null
}

export type SpeechValues = {
    program?: string // program name, from its on-chain metadata
    amount?: string // USDC per household, formatted
    money?: string | null // local money, e.g. "≈ ৳124"
    status?: string // the status line as shown
    message?: string // the card's message (valid, already claimed, not registered yet…)
    canClaim?: boolean // the Claim button is on screen
}

type Strings = (key: string) => any

/** What to say for a step, in the language of `s` (the app's t()). */
export function speechText(step: Step, s: Strings, v: SpeechValues = {}): string {
    const money = v.money ? `, ${s("about")} ${v.money.replace(/^≈\s*/, "")}` : ""
    const parts =
        step === "nocard" ? [s("noCard")]
        : step === "pin" ? [s("pinTitle")]
        : step === "paid" ? [s("readPaid")(v.amount)]
        : step === "join" ? [s("joinTitle"), s("joinHow"), v.message]
        : [`${s("program")}: ${v.program}`, `${s("amount")}: ${v.amount} USDC${money}`, v.status, v.message, v.canClaim ? s("readNext")(s("claim")) : null]
    return parts
        .filter((x): x is string => !!x)
        .map((x) => x.trim())
        // A pause between parts, without doubling a sentence's own stop; Bengali ends a sentence with "।".
        .map((x) => (/[.!?।…:]$/.test(x) ? x : `${x}${/[ঀ-৿]/.test(x) ? "।" : "."}`))
        .join(" ")
}

/**
 * A voice for the app language: the program country's variant first (bn-BD before bn-IN), then any voice
 * of that language. Never another language's voice: Bengali read by an English voice is noise.
 * Older Android engines name Indonesian "in-ID", and some name Filipino by Tagalog, "tl-PH".
 */
export function pickVoice<V extends { lang: string }>(voices: readonly V[], lang: string, country?: string): V | null {
    const codes = lang === "id" ? ["id", "in"] : lang === "fil" ? ["fil", "tl"] : [lang]
    const norm = (l: string) => l.toLowerCase().replace("_", "-")
    const of = (v: V) => norm(v.lang).split("-")
    const mine = voices.filter((v) => codes.includes(of(v)[0]))
    return mine.find((v) => country && of(v)[1] === country.toLowerCase()) ?? mine[0] ?? null
}

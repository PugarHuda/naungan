// "Why is the money coming?" in a household's own language: an AI model explains a program's trigger from its public,
// on-chain facts (rule, latest oracle report and its evidence, amount, claim window), and a guard rejects any answer
// that states a number the facts do not contain, carries a link or an address, or leaves out the amount. Nothing about
// a household ever reaches the model: only what anyone can read from the chain. Shared by api/explain.js and tests.
// The number guard is adapted from Recourse (dorahacks.io BUIDL 50094), which checks every figure in its AI-drafted
// appeal letters against the decision receipt.

export const LANGS = { en: "English", id: "Bahasa Indonesia", bn: "Bengali (বাংলা)", es: "Spanish", sw: "Kiswahili", pt: "European Portuguese", fil: "Filipino (Tagalog)" }

const HAZARD = { flood: "river flood", heat: "heatwave", wind: "cyclone wind" }

/** The public facts of one program, from the open-data summary (api/programs.js summarise). */
export function factsOf(p) {
    const f = {
        program: p.name,
        hazard: HAZARD[p.hazard] ?? "river flood",
        rule: p.trigger.rule,
        triggerPercent: p.trigger.thresholdPercent,
        state: p.state,
        amountUSDC: p.usdc.perHousehold
    }
    if (p.until) f.claimsOpenUntil = p.until.slice(0, 10)
    if (p.latestReport) {
        f.latestForecastPercent = p.latestReport.valuePercent
        f.oraclesAgreeing = `${p.latestReport.agreeing} of ${p.trigger.quorum} needed`
        f.reportedOn = p.latestReport.at.slice(0, 10)
        f.evidence = p.latestReport.evidence
    }
    return f
}

export function messages(facts, lang) {
    const name = LANGS[lang]
    if (!name) throw new Error(`unsupported language ${lang}`)
    const system = [
        `You explain an anticipatory cash program to a family that may receive its money. Write in ${name}, in plain words a person with little schooling understands, in at most 90 words, as one short paragraph. No headings, no lists, no markdown.`,
        "Say what the program watches, whether claims are open now and why (what the forecast showed against the trigger), how much each household receives, and until when it can claim if claims are open. If claims are not open, say what would open them.",
        "Use only the facts given. Do not write any number, date or percentage that is not in the facts; write dates with the day, month name and year. Never include links, wallet addresses, transaction ids or contact details. Do not give safety or evacuation advice beyond saying to follow local authorities. Name forecasts plainly (for example: the river forecast from Europe's Copernicus service); do not use technical terms such as GloFAS members or reanalysis without explaining them in simple words.",
        "Reply with the paragraph only."
    ].join(" ")
    return [{ role: "system", content: system }, { role: "user", content: "Facts (JSON, public and on-chain):\n" + JSON.stringify(facts, null, 2) }]
}

// Digits of the scripts our languages may answer in, to ASCII (Bengali; Devanagari and Arabic-Indic in case a model strays).
const DIGITS = [0x09e6, 0x0966, 0x0660, 0x06f0]
const ascii = (s) => s.replace(/[০-৯०-९٠-٩۰-۹]/g, (ch) => String(ch.codePointAt(0) - DIGITS.find((z) => ch.codePointAt(0) >= z && ch.codePointAt(0) <= z + 9)))

/** Every reading of a figure as written in any of our locales: 1.116 (pt/id thousands) or 1,116, 0,5 or 0.5. */
function readings(tok) {
    const t = tok
    const out = new Set([Number(t.replace(/[.,]/g, ""))])
    const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","))
    if (last > 0) out.add(Number(t.slice(0, last).replace(/[.,]/g, "") + "." + t.slice(last + 1)))
    return [...out].filter(Number.isFinite)
}

// Only . and , join digits: a space-separated "1 116" reads as two figures, so at worst a good answer is refused, never a bad one passed.
const numbersIn = (s) => ascii(s).match(/\d+(?:[.,]\d+)*/g) ?? []

/** The figures the facts allow: every number in them, and each date's day, month and year. */
export function allowed(facts) {
    const ok = new Set()
    const add = (v) => {
        // Facts side only: "5.575,95.325" (a coordinate pair) also counts as its two halves.
        for (const tok of numbersIn(String(v))) for (const part of [tok, ...tok.split(",")]) for (const n of readings(part)) ok.add(n)
        for (const m of String(v).matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) [m[1], m[2], m[3]].forEach((x) => ok.add(Number(x)))
    }
    for (const v of Object.values(facts)) add(v)
    return ok
}

/** null when the text may be shown, else the reason it is refused. */
export function check(text, facts) {
    if (!text || text.length > 900) return "empty or too long"
    if (/https?:|www\.|0x[0-9a-f]{6,}|@/i.test(text)) return "a link, address or contact"
    const ok = allowed(facts)
    for (const tok of numbersIn(text)) if (!readings(tok).some((n) => ok.has(n))) return `a figure not in the facts: ${tok}`
    if (!numbersIn(text).some((tok) => readings(tok).includes(Number(facts.amountUSDC)))) return "the amount is missing"
    return null
}

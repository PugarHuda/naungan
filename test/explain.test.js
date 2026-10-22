const { expect } = require("chai")
const { factsOf, messages, check, allowed, LANGS } = require("../lib/explain.mjs")

// Program #2 as the open data serves it (claims open after the replayed Nov 2025 Krueng Aceh flood).
const p2 = {
    id: 2, name: "Krueng Aceh flood · Aceh Besar", hazard: "flood", state: "claims open", until: "2026-11-18T15:46:04.000Z",
    trigger: { rule: "River flood: at least 60% of GloFAS members above the 1-in-5-year flood, 10-day lead", thresholdPercent: 60, lastIndexPercent: 100, quorum: 1 },
    usdc: { perHousehold: 1 },
    latestReport: { valuePercent: 100, agreeing: 1, evidence: "REPLAY of GloFAS v4 reanalysis via Open-Meteo (not a live forecast) | cell 5.575,95.325 | window 2025-11-20..2025-11-29 | peak 1116 m3/s on 2025-11-23 | 1-in-5y flood 963 m3/s (Gumbel, 29y)", at: "2026-10-19T15:46:04.000Z", tx: "0x783c" }
}

describe("AI explanation guard (lib/explain.mjs)", () => {
    const f = factsOf(p2)

    it("hands the model only public program facts, and asks for the household's language", () => {
        expect(Object.keys(f).sort()).to.deep.equal(["amountUSDC", "claimsOpenUntil", "evidence", "hazard", "latestForecastPercent", "oraclesAgreeing", "program", "reportedOn", "rule", "state", "triggerPercent"])
        expect(f.claimsOpenUntil).to.equal("2026-11-18")
        const [sys, user] = messages(f, "bn")
        expect(sys.content).to.include("Bengali")
        expect(user.content).to.include("1116 m3/s")
        expect(() => messages(f, "xx")).to.throw(/unsupported/)
        expect(Object.keys(LANGS)).to.have.length(7)
    })

    it("passes a faithful answer in English, Bahasa Indonesia with a decimal comma, and Bengali digits", () => {
        expect(check("The river forecast for Krueng Aceh showed 100% of its runs above the 1-in-5-year flood, more than the 60% the rule needs, so claims are open. Each household receives 1 USDC and can claim until 18 November 2026.", f)).to.equal(null)
        expect(check("Prakiraan sungai menunjukkan debit puncak 1.116 m3/detik pada 23 November 2025, di atas banjir 1-dalam-5-tahun (963 m3/detik). Setiap keluarga menerima 1 USDC sampai 18 November 2026.", f)).to.equal(null)
        expect(check("নদীর পূর্বাভাসে ১০০% সম্ভাবনা দেখা গেছে, যা ৬০% সীমার বেশি। প্রতিটি পরিবার ১ USDC পাবে, ১৮ নভেম্বর ২০২৬ পর্যন্ত।", f)).to.equal(null)
    })

    it("refuses an invented figure, in any script, a link or address, and an answer without the amount", () => {
        expect(check("Each household receives 1 USDC; 85% of runs showed a flood.", f)).to.match(/not in the facts: 85/)
        expect(check("প্রতিটি পরিবার ১ USDC পাবে, ৭৫% সম্ভাবনা।", f)).to.match(/not in the facts: 75/)
        expect(check("Each household receives 1 USDC. Water may rise 2,5 metres.", f)).to.match(/not in the facts/)
        expect(check("Each household receives 1 USDC, see https://naungan.vercel.app", f)).to.match(/link/)
        expect(check("Send 1 USDC to 0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E", f)).to.match(/address/)
        expect(check("Claims are open until 18 November 2026.", f)).to.match(/amount is missing/)
        expect(check("", f)).to.match(/empty/)
    })

    it("allows each date's day, month and year, and every number in the rule and evidence", () => {
        const ok = allowed(f)
        for (const n of [18, 11, 2026, 23, 2025, 1116, 963, 29, 60, 5, 10, 100, 1, 5.575, 95.325]) expect(ok.has(n), String(n)).to.equal(true)
        expect(ok.has(42)).to.equal(false)
    })
})

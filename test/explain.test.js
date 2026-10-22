const { expect } = require("chai")
const { factsOf, messages, check, allowed, languageOf, LANGS } = require("../lib/explain.mjs")

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
        expect(check("Prakiraan sungai menunjukkan debit puncak 1.116 m3/detik pada 23 November 2025, di atas banjir yang terjadi sekali dalam 5 tahun (963 m3/detik). Setiap keluarga menerima 1 USDC sampai 18 November 2026, dan klaim dibuka untuk program ini.", f, "id")).to.equal(null)
        expect(check("নদীর পূর্বাভাসে ১০০% সম্ভাবনা দেখা গেছে, যা ৬০% সীমার বেশি। প্রতিটি পরিবার ১ USDC পাবে, ১৮ নভেম্বর ২০২৬ পর্যন্ত।", f, "bn")).to.equal(null)
    })

    // What Claude Haiku 5.5 answered for program #2 on 22 Oct 2026: right in Spanish, but in Indonesian when asked for Kiswahili.
    it("refuses an answer in the wrong language: Indonesian asked for Kiswahili, English asked for Bengali", () => {
        const es = "Este programa vigila el río Krueng Aceh, en Aceh Besar, y mira si el pronóstico del río del servicio europeo Copernicus indica una inundación grande dentro de diez días. Los reclamos están abiertos ahora, porque el pronóstico llegó al 100 por ciento de los modelos, y el límite era 60 por ciento. Cada familia puede recibir 1 dólar USDC. Puede reclamar hasta el 18 de noviembre de 2026. Siga siempre las indicaciones de las autoridades locales."
        expect(check(es, f, "es")).to.equal(null)
        const idForSw = "Program ini mengawasi sungai Krueng Aceh di Aceh Besar. Sekarang klaim terbuka, karena hasil ramalan terbaru menunjukkan 100%, lebih dari batas 60%. Setiap keluarga bisa menerima 1 USDC. Klaim bisa diajukan sampai 18 November 2026. Ikuti selalu arahan pemerintah setempat."
        expect(check(idForSw, f, "sw")).to.match(/written in Bahasa Indonesia, not Kiswahili/)
        expect(languageOf("Mpango huu unafuatilia mto Krueng Aceh. Madai yamefunguliwa kwa sababu utabiri ni 100%, juu ya kiwango cha 60%. Kila familia itapokea 1 USDC hadi 18 Novemba 2026.", "sw")).to.equal(null)
        expect(languageOf("Each household receives 1 USDC and can claim until 18 November 2026 if the forecast is above the trigger.", "bn")).to.equal("not Bengali script")
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

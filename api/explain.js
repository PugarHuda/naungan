// GET /api/explain?program=N&lang=xx → why a program's money is (or is not yet) coming, in the household's language,
// written by an AI model through Vercel AI Gateway from the program's public on-chain facts and checked by
// lib/explain.mjs before it is shown. Only those two parameters are accepted, so the CDN cache (one answer per program
// and language per oracle cycle) cannot be bypassed to run up model costs.
const { load, summarise, baseOf } = require("./programs")

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions"
const MODEL = process.env.AI_GATEWAY_MODEL || "anthropic/claude-haiku-5.5" // from https://ai-gateway.vercel.sh/v1/models
const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }

async function ask(token, msgs) {
    const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: msgs, max_tokens: 400, temperature: 0.2 }),
        signal: AbortSignal.timeout(30e3)
    })
    if (!res.ok) throw Object.assign(new Error(`AI Gateway answered ${res.status}`), { status: res.status })
    const j = await res.json()
    return { text: String(j.choices?.[0]?.message?.content ?? "").trim(), model: j.model ?? MODEL }
}

module.exports = async (req, res) => {
    const send = (code, body, cache) => (res.writeHead(code, { ...HEADERS, "cache-control": cache }), res.end(JSON.stringify(body)))
    const { LANGS, factsOf, messages, check } = await import("../lib/explain.mjs")
    const q = new URL(req.url, "http://x").searchParams
    const id = Number(q.get("program")), lang = q.get("lang") ?? "en"
    if ([...q.keys()].some((k) => k !== "program" && k !== "lang") || !Number.isInteger(id) || id < 1 || !LANGS[lang]) return send(400, { error: "use ?program=<id>&lang=<" + Object.keys(LANGS).join("|") + ">" }, "public, s-maxage=86400")
    const token = process.env.AI_GATEWAY_API_KEY || req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN
    // The explanation is optional: no model, or a model that fails, is an answer without text (200), not an error the claim app logs.
    if (!token) return send(200, { program: id, lang, text: null, refused: "AI explanations are not configured on this deployment" }, "public, s-maxage=300")
    let p
    try {
        const data = await load()
        p = summarise({ ...data, base: baseOf(req, data.d) }).find((x) => x.id === id)
    } catch (e) {
        console.error("explain: chain read failed", e)
        return send(503, { error: "chain unreachable right now, try again shortly" }, "no-store")
    }
    if (!p) return send(404, { error: `no program ${id}` }, "public, s-maxage=300")
    const facts = factsOf(p)
    const base = { program: id, lang, state: p.state, facts, report: p.latestReport?.tx ?? null }
    if (p.state === "over") return send(200, { ...base, text: null, refused: "the program is over" }, "public, s-maxage=3600")
    try {
        const msgs = messages(facts, lang)
        let a = await ask(token, msgs)
        let why = check(a.text, facts)
        if (why) {
            // One retry, told what was wrong; a second refusal shows the facts instead of an unchecked text.
            a = await ask(token, [...msgs, { role: "assistant", content: a.text }, { role: "user", content: `That answer cannot be shown: it contains ${why}. Rewrite it using only the facts.` }])
            why = check(a.text, facts)
        }
        if (why) return send(200, { ...base, text: null, refused: why, model: a.model }, "public, s-maxage=600")
        // One answer per program and language until the next oracle cycle (reports land about every 6 hours).
        return send(200, { ...base, text: a.text, model: a.model, checked: "every figure appears in the facts; no link, address or contact" }, "public, s-maxage=21600, stale-while-revalidate=3600")
    } catch (e) {
        console.error("explain: model failed", e.message)
        return send(200, { ...base, text: null, refused: `the AI model is unavailable right now (${e.status ?? "no answer"})` }, "public, s-maxage=120")
    }
}

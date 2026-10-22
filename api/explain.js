// GET /api/explain?program=N&lang=xx → why a program's money is (or is not yet) coming, in the household's language,
// written by an AI model through Vercel AI Gateway from the program's public on-chain facts and checked by
// lib/explain.mjs before it is shown. Only those two parameters are accepted, so the CDN cache (one answer per program
// and language per oracle cycle) cannot be bypassed to run up model costs. Behind the CDN, every answer is kept in the
// shared store per program, language and oracle report, one model call runs at a time per key, and a daily cap bounds
// the rest: a cache miss can never become a model call per request.
const { load, summarise, baseOf } = require("./programs")
const { sharedStore } = require("../scripts/relayer")

const store = sharedStore()
const DAILY_CALLS = 300 // 7 languages × 10 programs × 4 oracle cycles is 280

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
    // Only the one canonical spelling (no repeats, no padding, no extra keys), so each program and language has a single CDN entry.
    const u = new URL(req.url, "http://x"), m = /^\?program=([1-9]\d{0,5})&lang=([a-z]{2,3})$/.exec(u.search)
    if (!m || !LANGS[m[2]]) return send(400, { error: "use ?program=<id>&lang=<" + Object.keys(LANGS).join("|") + "> exactly" }, "public, s-maxage=86400")
    const id = Number(m[1]), lang = m[2]
    // Server-side credential only: never a token a request could carry.
    const token = process.env.AI_GATEWAY_API_KEY
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
    const key = `naungan:explain:${id}:${lang}:${base.report ?? "none"}`
    const kept = await store.get(key).catch(() => null)
    if (kept) return send(200, { ...base, ...JSON.parse(kept) }, "public, s-maxage=21600, stale-while-revalidate=3600")
    if (!(await store.claim(`${key}:lock`, "1", 60).catch(() => false))) // fail closed: no store, no model call return send(200, { ...base, text: null, refused: "being written, try again in a minute" }, "public, s-maxage=30")
    if ((await store.incr(`naungan:explain:calls:${new Date().toISOString().slice(0, 10)}`, 2 * 86400).catch(() => Infinity)) > DAILY_CALLS)
        return send(200, { ...base, text: null, refused: "the daily limit of AI explanations is reached" }, "public, s-maxage=600")
    try {
        const msgs = messages(facts, lang)
        let a = await ask(token, msgs)
        let why = check(a.text, facts)
        if (why) {
            // One retry, told what was wrong; a second refusal shows the facts instead of an unchecked text.
            a = await ask(token, [...msgs, { role: "assistant", content: a.text }, { role: "user", content: `That answer cannot be shown: it contains ${why}. Rewrite it using only the facts.` }])
            why = check(a.text, facts)
        }
        // A refusal is kept too (shorter): asking again for the same facts would mostly be refused again.
        if (why) return await store.set(key, JSON.stringify({ text: null, refused: why, model: a.model }), 3600).catch(() => {}), send(200, { ...base, text: null, refused: why, model: a.model }, "public, s-maxage=600")
        const answer = { text: a.text, model: a.model, checked: "every figure appears in the facts; no link, address or contact" }
        // One answer per program, language and oracle report (reports land about every 6 hours).
        await store.set(key, JSON.stringify(answer), 7 * 86400).catch(() => {})
        return send(200, { ...base, ...answer }, "public, s-maxage=21600, stale-while-revalidate=3600")
    } catch (e) {
        console.error("explain: model failed", e.message)
        return send(200, { ...base, text: null, refused: `the AI model is unavailable right now (${e.status ?? "no answer"})` }, "public, s-maxage=120")
    }
}

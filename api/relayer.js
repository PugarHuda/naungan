// Vercel serverless entry for the gas relayer (same core as `node scripts/relayer.js`).
// vercel.json rewrites /relay, /transfer and /health here; PRIVATE_KEY is a Vercel env var.
// In-flight/settled claims, the rate limit and PIN tries live in Upstash Redis when its env is set
// (scripts/relayer.js sharedStore), so every instance sees the same state.
const { createRelayer, HEADERS, MAX_BODY } = require("../scripts/relayer")

let relayer
module.exports = async (req, res) => {
    relayer ??= createRelayer()
    const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket?.remoteAddress
    let raw = ""
    for await (const chunk of req) if (raw.length <= MAX_BODY) raw += chunk // drain, don't break: breaking destroys the socket
    const path = new URL(req.url, "http://x").searchParams.get("route") ?? "/health"
    let code, body
    try {
        ;[code, body] = await (await relayer).handle(req.method, path, ip, raw)
    } catch (e) {
        relayer = null // startup failed (RPC down, missing env): retry on the next request
        console.error("relayer startup failed", e) // details stay in the Vercel log, not the response
        ;[code, body] = [503, { error: "relayer unavailable, try again shortly" }]
    }
    res.writeHead(code, HEADERS)
    res.end(JSON.stringify(body))
}

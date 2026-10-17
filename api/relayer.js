// Vercel serverless entry for the gas relayer (same core as `node scripts/relayer.js`).
// vercel.json rewrites /relay, /transfer and /health here; PRIVATE_KEY is a Vercel env var.
// ponytail: in-flight/settled sets and the rate limit live per warm instance, not globally;
// Vercel keeps one warm instance at this traffic, add a KV store if it scales out.
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
        ;[code, body] = [503, { error: `relayer unavailable: ${e.message}` }]
    }
    res.writeHead(code, HEADERS)
    res.end(JSON.stringify(body))
}

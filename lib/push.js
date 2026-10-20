// Web Push (RFC 8030) with VAPID (RFC 8292), payload-free: the push only wakes the phone's service worker,
// which reads the chain itself and writes the notification in the household's language. So no message
// encryption is needed, and neither the push service nor the relayer ever holds any alert text or card.
const crypto = require("crypto")

const b64u = (buf) => Buffer.from(buf).toString("base64url")

/**
 * The VAPID P-256 key pair, derived from the relayer's own key (HKDF), so push needs no new secret.
 * Rotating the relayer key rotates it, and phones re-subscribe on their next opt-in.
 */
function vapidKeys(seed) {
    const d = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(String(seed)), "naungan", "vapid-p256", 32))
    const ecdh = crypto.createECDH("prime256v1")
    ecdh.setPrivateKey(d) // throws on the ~2^-128 chance d is out of range
    const pub = ecdh.getPublicKey() // 65 bytes, uncompressed: what the browser's applicationServerKey takes
    const key = crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } })
    return { publicKey: b64u(pub), key }
}

// Only the browser vendors' push services: the relayer POSTs to these URLs, so anything else is refused (SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/]
function validEndpoint(s) {
    if (typeof s !== "string" || s.length > 1024) return false
    try {
        const u = new URL(s)
        return u.protocol === "https:" && !u.port && !u.username && PUSH_HOSTS.some((h) => h.test(u.hostname))
    } catch {
        return false
    }
}

/** RFC 8292 header: an ES256 JWT for the push service's origin, plus our public key. */
function vapidAuth(endpoint, { publicKey, key }, subject, now = Date.now() / 1000) {
    const enc = (o) => b64u(JSON.stringify(o))
    const body = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now) + 12 * 3600, sub: subject })}`
    const sig = crypto.sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" })
    return `vapid t=${body}.${b64u(sig)}, k=${publicKey}`
}

/** One wake-up push. Resolves to the push service's status (201 sent, 404/410 subscription gone). */
async function wake(endpoint, keys, subject) {
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: vapidAuth(endpoint, keys, subject), ttl: String(3 * 86400), urgency: "high", "content-length": "0" },
        signal: AbortSignal.timeout(10e3)
    })
    return res.status
}

module.exports = { vapidKeys, validEndpoint, vapidAuth, wake }

// PIN-locked claim cards. Scanning a stolen or photographed card is not enough to claim: the identity
// secret in the QR is AES-256-GCM encrypted under PBKDF2-SHA256(PIN), and the agency hands the PIN over separately.
// WebCrypto only, so the agency CLI (Node) and the claim app (browser bundle) run this same file.
//
// ponytail: a 6-digit PIN has 10^6 values. At 600k PBKDF2 iterations, trying them all is ~6e11 HMACs:
// about 3 days on one CPU core, but roughly a minute on a high-end GPU (~9e9 iterations/s). So this
// stops casual theft, photo copies and someone trying PINs on the phone; it does not stop an attacker
// with the card and a GPU. Upgrade path: a server-side PIN check with attempt limits (OPAQUE/OPRF).
const ITERATIONS = 600_000 // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
const enc = new TextEncoder()
const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

async function keyFor(pin, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"])
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
}

/** Encrypt `secret` for one program; the program id is bound as associated data. */
async function lock(secret, pin, programId) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(String(programId)) }, await keyFor(pin, salt), enc.encode(secret)))
    return b64(new Uint8Array([...salt, ...iv, ...ct]))
}

/** Returns the secret, or throws on a wrong PIN, another program's card, or a damaged code. */
async function unlock(blob, pin, programId) {
    const raw = unb64(blob)
    if (raw.length < 16 + 12 + 17) throw new Error("damaged card code")
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(16, 28), additionalData: enc.encode(String(programId)) }, await keyFor(pin, raw.slice(0, 16)), raw.slice(28))
    return new TextDecoder().decode(pt)
}

/** Uniform 6-digit PIN from the CSPRNG (rejection sampling, no modulo bias). */
function newPin() {
    const max = 4294967296 - (4294967296 % 1e6)
    for (;;) {
        const [x] = crypto.getRandomValues(new Uint32Array(1))
        if (x < max) return String(x % 1e6).padStart(6, "0")
    }
}

module.exports = { lock, unlock, newPin, ITERATIONS }

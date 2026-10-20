// PIN-locked claim cards. Scanning a stolen or photographed card is not enough to claim: the identity
// secret in the QR is AES-256-GCM encrypted under a key derived from the PIN, and the agency hands the
// PIN over separately. WebCrypto + noble only, so the agency CLI (Node), the relayer and the claim app
// (browser bundle) run this same file.
//
// v2 cards (`e2=`, the default) mix in an OPRF (RFC 9497 style, ristretto255) evaluated by the relayer:
// the key is PBKDF2(PIN ‖ F_k(card, PIN)), where only the server holds k and the phone blinds its input,
// so the server never sees the PIN and nobody can test a PIN without asking the server. The server
// counts evaluations per card and stops after MAX_TRIES: with a 6-digit PIN that leaves a thief who has
// the card a 20-in-a-million chance, instead of the offline GPU search that breaks v1 in about a minute.
//
// v1 cards (`e=`) stay readable: PBKDF2(PIN) only. ponytail: a 6-digit PIN has 10^6 values; at 600k
// iterations that is ~3 days on one CPU core but roughly a minute on a high-end GPU (~9e9 iterations/s).
import { RistrettoPoint, hashToRistretto255, ed25519 } from "@noble/curves/ed25519.js"
import { mod, invert } from "@noble/curves/abstract/modular.js"
import { bytesToNumberLE } from "@noble/curves/abstract/utils.js"

const ITERATIONS = 600_000 // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
const MAX_TRIES = 20 // server-side PIN checks per v2 card, issuance included
const OPRF_DST = "naungan-pin-oprf-v1"
const N = ed25519.CURVE.n
const enc = new TextEncoder()
const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("")
const unhex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16))

async function keyFor(pin, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"])
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
}
const randomScalar = () => mod(bytesToNumberLE(crypto.getRandomValues(new Uint8Array(64))), N - 1n) + 1n

// --- OPRF: the phone blinds, the server evaluates, the phone unblinds --------------------------------

/**
 * Server key for one card, from a seed the server already guards (the relayer's private key); never 0.
 * Partially oblivious: the (program, card) the server counts tries against is also part of the key, so
 * a request naming another card id gets an answer that is useless for the real card. Without this a
 * thief could send the real card's blinded points under fresh made-up ids and never hit the limit.
 */
async function oprfKey(seed, programId, card) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-512", enc.encode(`${OPRF_DST}|key|${seed}|${programId}|${card}`)))
    return mod(bytesToNumberLE(h), N - 1n) + 1n
}
/** Phone side: hide (program, card, PIN) behind a random scalar r. Returns { r, point } for evaluate(). */
function blind(programId, card, pin) {
    const r = randomScalar()
    const P = hashToRistretto255(enc.encode(`${programId}|${card}|${pin}`), { DST: OPRF_DST })
    return { r, point: P.multiply(r).toHex() }
}
/** Server side: k·B. Rejects anything that is not a valid, non-identity ristretto255 encoding. */
function evaluate(key, point) {
    if (typeof point !== "string" || !/^[0-9a-f]{64}$/.test(point)) throw new Error("point must be 32 bytes hex")
    const B = RistrettoPoint.fromHex(point) // throws on a non-canonical encoding
    if (B.equals(RistrettoPoint.ZERO)) throw new Error("identity point")
    return B.multiply(key).toHex()
}
/** Phone side: r⁻¹·(k·r·P) = k·P, hashed with the input as in RFC 9497 Finalize. */
async function finalize(programId, card, pin, r, evaluated) {
    const Z = RistrettoPoint.fromHex(evaluated).multiply(invert(r, N))
    const msg = new Uint8Array([...enc.encode(`${OPRF_DST}|${programId}|${card}|${pin}|`), ...Z.toRawBytes()])
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", msg)))
}
/** The full round trip; `ask({ programId, card, point })` sends the blinded point to the server. */
async function oprf(programId, card, pin, ask) {
    const { r, point } = blind(programId, card, pin)
    return finalize(programId, card, pin, r, await ask({ programId: String(programId), card, point }))
}

// --- cards -------------------------------------------------------------------------------------------

async function seal(secret, password, ad, prefix) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(ad) }, await keyFor(password, salt), enc.encode(secret)))
    return b64(new Uint8Array([...prefix, ...salt, ...iv, ...ct]))
}
async function open(raw, password, ad) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(16, 28), additionalData: enc.encode(ad) }, await keyFor(password, raw.slice(0, 16)), raw.slice(28))
    return new TextDecoder().decode(pt)
}

/** v1: encrypt `secret` for one program; the program id is bound as associated data. */
async function lock(secret, pin, programId) {
    return seal(secret, pin, String(programId), [])
}
/** v1: returns the secret, or throws on a wrong PIN, another program's card, or a damaged code. */
async function unlock(blob, pin, programId) {
    const raw = unb64(blob)
    if (raw.length < 16 + 12 + 17) throw new Error("damaged card code")
    return open(raw, pin, String(programId))
}

/** v2: a fresh random card id, then the key needs the server's OPRF answer for (program, card, PIN). */
async function lockV2(secret, pin, programId, ask) {
    const card = hex(crypto.getRandomValues(new Uint8Array(16)))
    const f = await oprf(programId, card, pin, ask)
    return seal(secret, `${pin}:${f}`, `v2:${programId}`, unhex(card))
}
/** v2: one server check per call (counted against MAX_TRIES), then a local decrypt. */
async function unlockV2(blob, pin, programId, ask) {
    const raw = unb64(blob)
    if (raw.length < 16 + 16 + 12 + 17) throw new Error("damaged card code")
    const card = hex(raw.slice(0, 16))
    const f = await oprf(programId, card, pin, ask)
    return open(raw.slice(16), `${pin}:${f}`, `v2:${programId}`)
}

/** Uniform 6-digit PIN from the CSPRNG (rejection sampling, no modulo bias). */
function newPin() {
    const max = 4294967296 - (4294967296 % 1e6)
    for (;;) {
        const [x] = crypto.getRandomValues(new Uint32Array(1))
        if (x < max) return String(x % 1e6).padStart(6, "0")
    }
}

export { lock, unlock, lockV2, unlockV2, newPin, oprfKey, blind, evaluate, finalize, ITERATIONS, MAX_TRIES }

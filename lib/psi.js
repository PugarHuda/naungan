// Private cross-agency deduplication via DDH-based Private Set Intersection (semi-honest).
// Agency A learns which of ITS households also appear at agency B. B learns only set sizes.
// Neither side ever sees the other's beneficiary list, names, or hashes it could brute-force.
//
// ponytail: "fuzzy" = normalization + phonetic blocking keys (Fatima/Fatimah, Muhammad/Mohammed).
// Ceiling: misses typo-level variants; upgrade path is fuzzy PSI (e.g. xDup, arXiv 2604.08019).
const { RistrettoPoint, hashToRistretto255, ed25519 } = require("@noble/curves/ed25519")
const { randomBytes } = require("@noble/hashes/utils")

const DST = "naungan-psi-v1"
const N = ed25519.CURVE.n

function randomScalar() {
    let s = 0n
    while (s === 0n) s = BigInt("0x" + Buffer.from(randomBytes(64)).toString("hex")) % N
    return s
}

function soundex(word) {
    const codes = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 }
    let out = word[0].toUpperCase()
    let prev = codes[word[0]]
    for (const ch of word.slice(1)) {
        const c = codes[ch]
        if (c && c !== prev) out += c
        if (ch !== "h" && ch !== "w") prev = c
    }
    return (out + "000").slice(0, 4)
}

function nameTokens(name) {
    return name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .sort()
}

/** Matching keys for one household record {name, birthYear, village}. */
function recordKeys({ name, birthYear, village }) {
    const tokens = nameTokens(name)
    const v = nameTokens(village).join(" ")
    return [`n:${tokens.join(" ")}|y:${birthYear}`, `p:${tokens.map(soundex).sort().join(" ")}|y:${birthYear}|v:${v}`]
}

const toPoint = (key) => hashToRistretto255(Buffer.from(key), { DST })

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Buffer.from(randomBytes(4)).readUInt32LE() % (i + 1)
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
}

class Agency {
    constructor(records) {
        this.records = records
        this.secret = randomScalar()
    }

    /** Step 1 (A -> B): A's keys blinded with A's secret. */
    request() {
        this.layout = []
        const points = []
        this.records.forEach((r, i) =>
            recordKeys(r).forEach((k) => {
                this.layout.push(i)
                points.push(toPoint(k).multiply(this.secret).toHex())
            })
        )
        return points
    }

    /** Step 2 (B -> A): re-blind A's points in order; send B's own blinded keys shuffled. */
    respond(requestPoints) {
        const doubled = requestPoints.map((h) => RistrettoPoint.fromHex(h).multiply(this.secret).toHex())
        const own = shuffle(this.records.flatMap(recordKeys).map((k) => toPoint(k).multiply(this.secret).toHex()))
        return { doubled, own }
    }

    /** Step 3 (A only): indices of A's records that B also serves. */
    intersect({ doubled, own }) {
        const theirs = new Set(own.map((h) => RistrettoPoint.fromHex(h).multiply(this.secret).toHex()))
        const dup = new Set()
        doubled.forEach((h, j) => theirs.has(h) && dup.add(this.layout[j]))
        return dup
    }
}

/** In-process run of the 3-message protocol. In production each step is a network message. */
function privateDedup(a, b) {
    return a.intersect(b.respond(a.request()))
}

module.exports = { Agency, privateDedup, recordKeys, soundex }

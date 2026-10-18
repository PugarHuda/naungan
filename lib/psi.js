// Private cross-agency deduplication via DDH-based Private Set Intersection (semi-honest).
// Agency A learns which of ITS households also appear at agency B. B learns only set sizes.
// Neither side ever sees the other's beneficiary list, names, or hashes it could brute-force.
//
// "Fuzzy" = normalization + phonetic blocking keys: Fatima/Fatimah, Muhammad/Mohammed, Acehnese titles
// (Teuku/T., Teungku/Tgk, Cut, Haji/H.) and "bin/binti" dropped, pre-1972 spelling (Oemar/Umar, Djamal/Jamal).
// A birth year one off (common with estimated ages) is a *near* match: held back for a human to check,
// never silently merged, because a namesake in the same village is also one year off.
// ponytail: typo-level variants beyond Soundex (Fatimha) still miss; that needs edit-distance PSI.
const { RistrettoPoint, hashToRistretto255, ed25519 } = require("@noble/curves/ed25519")
const { randomBytes } = require("@noble/hashes/utils")

const DST = "naungan-psi-v2"
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

// Titles and patronymic links that one register writes and another leaves out.
const DROP = new Set(["teuku", "t", "teungku", "tengku", "tgk", "cut", "pocut", "haji", "h", "hajjah", "hj", "bin", "binti", "bt", "bn"])
// 1947/1972 spelling reforms: registers still carry old forms (Oemar, Djamal, Tjut, Sjech, Chairul).
const OLD = [[/oe/g, "u"], [/dj/g, "j"], [/tj/g, "c"], [/nj/g, "ny"], [/sj/g, "sy"], [/ch/g, "kh"]]

function nameTokens(name, drop = DROP) {
    let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    for (const [a, b] of OLD) s = s.replace(a, b)
    return s
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t && !drop.has(t))
        .sort()
}

/** Matching keys for one household record {name, birthYear, village}; `near` adds the year ±1 probes. */
function recordKeys({ name, birthYear, village }, near = false) {
    const tokens = nameTokens(name).length ? nameTokens(name) : nameTokens(name, new Set()) // a name that is only a title
    const v = nameTokens(village, new Set()).join(" ")
    const p = (y) => `p:${tokens.map(soundex).sort().join(" ")}|y:${y}|v:${v}`
    const keys = [{ k: `n:${tokens.join(" ")}|y:${birthYear}`, near: false }, { k: p(birthYear), near: false }]
    if (near) keys.push({ k: p(birthYear - 1), near: true }, { k: p(birthYear + 1), near: true })
    return keys
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
            recordKeys(r, true).forEach(({ k, near }) => {
                this.layout.push({ i, near })
                points.push(toPoint(k).multiply(this.secret).toHex())
            })
        )
        return points
    }

    /** Step 2 (B -> A): re-blind A's points in order; send B's own blinded keys shuffled. */
    respond(requestPoints) {
        const doubled = requestPoints.map((h) => RistrettoPoint.fromHex(h).multiply(this.secret).toHex())
        const own = shuffle(this.records.flatMap((r) => recordKeys(r)).map(({ k }) => toPoint(k).multiply(this.secret).toHex()))
        return { doubled, own }
    }

    /** Step 3 (A only): indices of A's records that B also serves; `near` = only a year-±1 match, for review. */
    intersect({ doubled, own }) {
        if (doubled.length !== this.layout.length) throw new Error("peer answered a different request")
        const theirs = new Set(own.map((h) => RistrettoPoint.fromHex(h).multiply(this.secret).toHex()))
        const dup = new Set(), near = new Set()
        doubled.forEach((h, j) => theirs.has(h) && (this.layout[j].near ? near : dup).add(this.layout[j].i))
        for (const i of dup) near.delete(i)
        return Object.assign(dup, { near })
    }
}

/** In-process run of the 3-message protocol. In production each step is a network message. */
function privateDedup(a, b) {
    return a.intersect(b.respond(a.request()))
}

module.exports = { Agency, privateDedup, recordKeys, soundex, nameTokens, DST }

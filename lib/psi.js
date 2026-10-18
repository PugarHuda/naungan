// Private cross-agency deduplication via DDH-based Private Set Intersection (semi-honest).
// Agency A learns which of ITS households also appear at agency B. B learns only set sizes.
// Neither side ever sees the other's beneficiary list, names, or hashes it could brute-force.
//
// "Fuzzy" = normalization + phonetic blocking keys: Fatima/Fatimah, Muhammad/Mohammed, Acehnese titles
// (Teuku/T., Teungku/Tgk, Cut, Haji/H.) and "bin/binti" dropped, pre-1972 spelling (Oemar/Umar, Djamal/Jamal).
// A birth year one off (common with estimated ages) is a *near* match: held back for a human to check,
// never silently merged, because a namesake in the same village is also one year off.
// Typos Soundex does not absorb (Dewi/Devi, Mulyadi/Muryadi) are near matches too: both sides add deletion-neighbourhood keys
// (SymSpell-style: every spelling with one letter removed), so any edit distance of 1 in one name word
// shares a key, inside the same village and birth year.
// ponytail: ~1 key per letter of the name, so requests grow ~15x; two typos in one word still miss.
const { RistrettoPoint, hashToRistretto255, ed25519 } = require("@noble/curves/ed25519")
const { randomBytes } = require("@noble/hashes/utils")

const DST = "naungan-psi-v3"
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

// Name profiles: how two registers of the same region write the same person differently. Both agencies
// must use the same profile (the request names it), or every key differs and nothing would match.
const strip = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
const PROFILES = {
    // Indonesia, Malaysia, Brunei. 1947/1972 spelling reforms: registers still carry old forms (Oemar,
    // Djamal, Tjut, Sjech, Chairul, Jusuf). Old j was today's y and old dj today's j, so j and y fold
    // together: Jusuf, Yusuf and Djusuf all read "yusuf". Titles and patronymic links (Teuku, Cut, Haji,
    // bin/binti) are written by one register and left out by another.
    id: {
        fold: (s) => [[/oe/g, "u"], [/dj/g, "j"], [/tj/g, "c"], [/nj/g, "ny"], [/sj/g, "sy"], [/ch/g, "kh"], [/j/g, "y"]].reduce((x, [a, b]) => x.replace(a, b), strip(s)),
        drop: ["teuku", "t", "teungku", "tengku", "tgk", "cut", "pocut", "haji", "h", "hajjah", "hj", "bin", "binti", "bt", "bn"]
    },
    // Anywhere else: accents and case only, and a few honorifics most registers drop. Soundex and the
    // one-typo keys still catch Mohammed/Muhammad or Jon/John; no j/y folding, so Jan and Yan stay apart.
    basic: { fold: strip, drop: ["mr", "mrs", "ms", "dr", "sr", "jr", "md"] }
}
for (const p of Object.values(PROFILES)) p.drop = new Set(p.drop.map(p.fold))
const DEFAULT_PROFILE = "id"
const profileOf = (name) => {
    const p = PROFILES[name]
    if (!p) throw new Error(`unknown name profile "${name}" (use ${Object.keys(PROFILES).join(" or ")})`)
    return p
}

function nameTokens(name, drop, profile = DEFAULT_PROFILE) {
    const p = profileOf(profile)
    return p.fold(name)
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t && !(drop ?? p.drop).has(t))
        .sort()
}

/** Matching keys for one household record {name, birthYear, village}; `near` adds the year ±1 probes (requester only). */
function recordKeys({ name, birthYear, village }, near = false, profile = DEFAULT_PROFILE) {
    const tokens = nameTokens(name, undefined, profile).length ? nameTokens(name, undefined, profile) : nameTokens(name, new Set(), profile) // a name that is only a title
    const v = nameTokens(village, new Set(), profile).join(" ")
    const p = (y) => `p:${tokens.map(soundex).sort().join(" ")}|y:${y}|v:${v}`
    const keys = [{ k: `n:${tokens.join(" ")}|y:${birthYear}`, near: false }, { k: p(birthYear), near: false }]
    if (near) keys.push({ k: p(birthYear - 1), near: true }, { k: p(birthYear + 1), near: true })
    const d = new Set([tokens.join(" ")])
    tokens.forEach((t, i) => {
        if (t.length < 4) return // "nur" → "nu" would join too many unrelated names
        for (let j = 0; j < t.length; j++) d.add(tokens.map((u, x) => (x === i ? t.slice(0, j) + t.slice(j + 1) : u)).sort().join(" "))
    })
    for (const n of d) keys.push({ k: `d:${n}|y:${birthYear}|v:${v}`, near: true })
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
    constructor(records, { profile = DEFAULT_PROFILE } = {}) {
        profileOf(profile)
        this.records = records
        this.profile = profile
        this.secret = randomScalar()
    }

    /** Step 1 (A -> B): A's keys blinded with A's secret. */
    request() {
        this.layout = []
        const points = []
        this.records.forEach((r, i) =>
            recordKeys(r, true, this.profile).forEach(({ k, near }) => {
                this.layout.push({ i, near })
                points.push(toPoint(k).multiply(this.secret).toHex())
            })
        )
        return points
    }

    /** Step 2 (B -> A): re-blind A's points in order; send B's own blinded keys shuffled. */
    respond(requestPoints) {
        const doubled = requestPoints.map((h) => RistrettoPoint.fromHex(h).multiply(this.secret).toHex())
        const own = shuffle(this.records.flatMap((r) => recordKeys(r, false, this.profile)).map(({ k }) => toPoint(k).multiply(this.secret).toHex()))
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

module.exports = { Agency, privateDedup, recordKeys, soundex, nameTokens, DST, PROFILES, DEFAULT_PROFILE }

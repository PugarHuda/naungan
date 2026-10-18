const fs = require("fs")

/** RFC 4180-style line parser: commas inside quotes, "" as an escaped quote. */
function parseLine(line) {
    const cells = []
    let cur = "", q = false
    for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (q) {
            if (c === '"' && line[i + 1] === '"') (cur += '"'), i++
            else if (c === '"') q = false
            else cur += c
        } else if (c === '"') q = true
        else if (c === ",") cells.push(cur.trim()), (cur = "")
        else cur += c
    }
    if (q) throw new Error(`unterminated quote: ${line}`)
    cells.push(cur.trim())
    return cells
}

// BN254 scalar field: a Semaphore identity commitment is an element of it.
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

/**
 * A commitment a household's own phone made (claim app, "join" link): the agency enrolls it and never
 * sees the secret behind it. Accepts the scanned QR text `naungan-commitment:<program>:<n>` or a bare n.
 */
function parseCommitment(text, program) {
    const m = String(text).trim().match(/^(?:naungan-commitment:(\d+):)?(\d{1,78})$/)
    if (!m) throw new Error("not a Naungan commitment")
    if (m[1] !== undefined && program !== undefined && BigInt(m[1]) !== BigInt(program)) throw new Error(`made for program ${m[1]}, not ${program}`)
    const c = BigInt(m[2])
    if (c === 0n || c >= FIELD) throw new Error("commitment out of range")
    return c
}

/**
 * Household list → [{name, birthYear, village, commitment?}]. Rejects rows that would silently break
 * dedup. An optional `commitment` column holds what the household's phone showed at registration.
 */
function readHouseholds(file, program) {
    const [head, ...body] = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).map(parseLine)
    const col = (k) => {
        const i = head.indexOf(k)
        if (i < 0) throw new Error(`${file}: missing column "${k}"`)
        return i
    }
    const [n, y, v] = ["name", "birthYear", "village"].map(col)
    const k = head.indexOf("commitment")
    const seen = new Set()
    return body.map((r, i) => {
        const rec = { name: r[n], birthYear: Number(r[y]), village: r[v] }
        if (!rec.name || !rec.village || !Number.isInteger(rec.birthYear) || rec.birthYear < 1900 || rec.birthYear > 2100)
            throw new Error(`${file}: row ${i + 2} is incomplete or has a bad birthYear`)
        if (k >= 0 && r[k]) {
            try {
                rec.commitment = parseCommitment(r[k], program)
            } catch (e) {
                throw new Error(`${file}: row ${i + 2}: ${e.message}`)
            }
            if (seen.has(rec.commitment)) throw new Error(`${file}: row ${i + 2} repeats a commitment`)
            seen.add(rec.commitment)
        }
        return rec
    })
}

module.exports = { parseLine, readHouseholds, parseCommitment }

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

/** Household list → [{name, birthYear, village}]. Rejects rows that would silently break dedup. */
function readHouseholds(file) {
    const [head, ...body] = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).map(parseLine)
    const col = (k) => {
        const i = head.indexOf(k)
        if (i < 0) throw new Error(`${file}: missing column "${k}"`)
        return i
    }
    const [n, y, v] = ["name", "birthYear", "village"].map(col)
    return body.map((r, i) => {
        const rec = { name: r[n], birthYear: Number(r[y]), village: r[v] }
        if (!rec.name || !rec.village || !Number.isInteger(rec.birthYear) || rec.birthYear < 1900 || rec.birthYear > 2100)
            throw new Error(`${file}: row ${i + 2} is incomplete or has a bad birthYear`)
        return rec
    })
}

module.exports = { parseLine, readHouseholds }

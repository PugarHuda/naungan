#!/usr/bin/env node
// Agency tool: private dedup between agencies over HTTP, then anonymous enrollment + claim cards.
//
// Agency B answers dedup queries (only from agencies registered on-chain for the program):
//   node scripts/agency.js serve  --program 1 --list data/unhcr.csv --port 7001
// Agency A dedups against B, enrolls the households B does not already serve, prints QR claim cards
// (possible matches, birth year one off or a one-letter typo, go to <list>.review.csv instead of being enrolled):
//   node scripts/agency.js enroll --program 1 --list data/zakat.csv --peer http://localhost:7001 \
//        --claim-url http://localhost:5173/claim.html --cards cards/zakat.html [--pin]
//   --pin locks each card with a 6-digit PIN printed on a separate slip (cards/zakat.pins.html).
//
// CSV columns: name,birthYear,village (quotes allowed). Cards hold claim secrets: keep them offline.
const fs = require("fs")
const path = require("path")
const http = require("http")
const { parseArgs } = require("util")
const { ethers } = require("ethers")
const QRCode = require("qrcode")
const { lock, newPin } = require("../lib/cardlock")
const { Identity } = require("@semaphore-protocol/core")
const { Agency, DST } = require("../lib/psi")
const { connect, explain } = require("../lib/chain")
const { readHouseholds: readCsv } = require("../lib/csv")

const MAX_POINTS = 300000 // 10k households × ~30 keys (exact, phonetic, year ±1, typo); bounds the work an authorised peer can demand
const FRESH_MS = 5 * 60e3

// The signed payload binds the program, a timestamp and the exact points, so it can't be replayed elsewhere.
const digest = (programId, ts, points) => ethers.solidityPackedKeccak256(["string", "uint256", "uint256", "bytes32"], ["naungan-psi", programId, ts, ethers.id(points.join(","))])

async function serve({ program, list, port }) {
    const { naungan, wallet } = await connect()
    const me = new Agency(readCsv(list))
    http.createServer(async (req, res) => {
        const reply = (code, body) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(body)))
        if (req.method !== "POST" || req.url !== "/psi") return reply(404, { error: "not found" })
        let raw = ""
        for await (const c of req) if ((raw += c).length > 24e6) return reply(413, { error: "too large" })
        try {
            const { points, ts, signature, v } = JSON.parse(raw)
            if (v !== DST) throw new Error(`peer runs dedup ${v ?? "naungan-psi-v1"}, this agency runs ${DST}: update both to the same release`)
            if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS) throw new Error("bad points")
            if (Math.abs(Date.now() - Number(ts)) > FRESH_MS) throw new Error("stale request")
            const from = ethers.verifyMessage(ethers.getBytes(digest(program, ts, points)), signature)
            if (!(await naungan.isAgency(program, from))) return reply(403, { error: `${from} is not an agency of program ${program}` })
            console.log(`${new Date().toISOString()} dedup query from ${from}: ${points.length} blinded keys`)
            reply(200, me.respond(points))
        } catch (e) {
            reply(400, { error: e.message })
        }
    }).listen(port, () => console.log(`agency ${wallet.address} answering dedup for program ${program} on :${port} (${me.records.length} households)`))
}

async function enroll({ program, list, peer = [], "claim-url": claimUrl, cards, pin: withPin }) {
    const { naungan, wallet } = await connect()
    if (!(await naungan.isAgency(program, wallet.address))) throw new Error(`${wallet.address} is not an agency of program ${program}`)
    const records = readCsv(list)
    const dup = new Set(), near = new Set()
    for (const url of peer) {
        const me = new Agency(records)
        const points = me.request()
        const ts = Date.now()
        const signature = await wallet.signMessage(ethers.getBytes(digest(program, ts, points)))
        const res = await fetch(new URL("/psi", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points, ts, signature, v: DST }) })
        const body = await res.json()
        if (!res.ok) throw new Error(`${url}: ${body.error}`)
        const found = me.intersect(body)
        found.forEach((i) => dup.add(i))
        found.near.forEach((i) => near.add(i))
        console.log(`dedup vs ${url}: ${found.size} of ${records.length} already served there, ${found.near.size} possible (birth year one off, or a one-letter typo)`)
    }
    for (const i of dup) near.delete(i)
    // Possible matches are not enrolled: a person checks them with the other agency, then enrolls this file.
    if (near.size) {
        const q = (x) => `"${String(x).replace(/"/g, '""')}"`
        const file = list.replace(/\.csv$/i, "") + ".review.csv"
        fs.writeFileSync(file, "name,birthYear,village\n" + [...near].map((i) => [records[i].name, records[i].birthYear, records[i].village].map(q).join(",")).join("\n") + "\n")
        console.log(`held back ${near.size} possible duplicates → ${file} (confirm with the peer agency, then enroll the real new ones from that file without --peer)`)
    }
    const fresh = records.filter((_, i) => !dup.has(i) && !near.has(i))
    if (fresh.length === 0) return console.log("nothing to enroll")

    const ids = fresh.map(() => new Identity())
    for (let i = 0; i < ids.length; i += 100) {
        const tx = await naungan.enroll(program, ids.slice(i, i + 100).map((x) => x.commitment))
        await tx.wait()
        console.log(`enrolled ${Math.min(i + 100, ids.length)}/${ids.length} · ${tx.hash}`)
    }

    const meta = JSON.parse(await naungan.metadata(program))
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
    // --pin: the QR holds the secret encrypted under a 6-digit PIN that goes on a separate slip.
    const pins = withPin ? fresh.map(newPin) : []
    const cardHtml = await Promise.all(fresh.map(async (r, i) => {
        const code = withPin ? `p=${program}&e=${await lock(ids[i].export(), pins[i], program)}` : `p=${program}&id=${encodeURIComponent(ids[i].export())}`
        const svg = await QRCode.toString(`${claimUrl}#${code}`, { type: "svg", errorCorrectionLevel: "M", margin: 1 })
        // Indonesian first: the households read the card; English below for agency staff.
        return `<article><div class="qr">${svg}</div><div><h2>Kartu klaim Naungan #${i + 1} <span lang="en">· claim card</span></h2><p class="who">${esc(r.name)} · ${esc(r.village)}</p>
<p>${esc(meta.name)}</p><ol><li>Pindai dengan kamera HP. <span lang="en">Scan with your phone camera.</span></li>${withPin ? `<li>Masukkan PIN 6 angka dari lembaga. <span lang="en">Enter the 6-digit PIN your agency gave you.</span></li>` : ""}<li>Saat peringatan banjir membuka klaim, ketuk <b>Klaim sekarang</b>. <span lang="en">When the flood alert opens claims, tap <b>Claim now</b>.</span></li></ol>
<p class="code">Tidak ada kamera? Buka ${esc(claimUrl)} lalu masukkan: <span lang="en">No camera? Open it and enter:</span> <code>${esc(code)}</code></p>
<p class="warn">${withPin ? `Simpan PIN terpisah dari kartu ini. Kartu saja tidak bisa dipakai klaim. <span lang="en">Keep your PIN apart from this card. The card alone cannot be claimed.</span>` : `Rahasiakan kartu ini. Siapa pun yang memegangnya bisa klaim sekali untuk rumah tangga ini. <span lang="en">Keep this card private. Anyone holding it can claim once for this household.</span>`}</p></div></article>`
    }))
    if (withPin) {
        const pinFile = cards.replace(/\.html?$/, "") + ".pins.html"
        fs.writeFileSync(pinFile, `<!doctype html><html lang="id"><meta charset="utf-8"><title>Slip PIN Naungan</title><style>body{font:15px system-ui,sans-serif;margin:16px}[lang=en]{color:#555;font-size:.85em}
p{border:1px dashed #999;border-radius:8px;padding:12px;max-width:420px;page-break-inside:avoid}b{font:700 24px ui-monospace,monospace;letter-spacing:4px}</style>
${fresh.map((r, i) => `<p>Kartu #${i + 1} · ${esc(r.name)} · ${esc(r.village)}<br>PIN <b>${pins[i]}</b><br>Serahkan terpisah dari kartu. <span lang="en">Hand over separately from the card.</span></p>`).join("\n")}`)
        console.log(`wrote ${fresh.length} PIN slips → ${pinFile} (print and hand out apart from the cards)`)
    }
    fs.mkdirSync(path.dirname(cards), { recursive: true })
    fs.writeFileSync(cards, `<!doctype html><html lang="id"><meta charset="utf-8"><title>Kartu klaim Naungan</title><style>[lang=en]{color:#555;font-size:.9em}
body{font:14px/1.4 system-ui,sans-serif;margin:16px}article{display:flex;gap:16px;border:1px solid #999;border-radius:10px;padding:14px;margin:0 0 12px;page-break-inside:avoid;max-width:640px}
.qr{width:180px;flex:none}h2{margin:0 0 4px;font-size:17px}.who{font-weight:600}.warn{color:#b5541c;font-size:12px}ol{padding-left:18px;margin:6px 0}.code{font-size:11px;word-break:break-all}
</style>${cardHtml.join("\n")}`)
    console.log(`wrote ${fresh.length} claim cards → ${cards}`)
}

const { values: a, positionals: [cmd] } = parseArgs({
    allowPositionals: true,
    options: { program: { type: "string" }, list: { type: "string" }, port: { type: "string", default: "7001" }, peer: { type: "string", multiple: true }, "claim-url": { type: "string" }, cards: { type: "string" }, pin: { type: "boolean" } }
})
const need = (...k) => k.forEach((x) => { if (!a[x]) throw new Error(`--${x} is required`) })

;(async () => {
    need("program", "list")
    a.program = BigInt(a.program)
    if (cmd === "serve") return serve({ ...a, port: Number(a.port) })
    if (cmd === "enroll") return need("claim-url", "cards"), enroll(a)
    throw new Error("usage: agency.js serve|enroll --program <id> --list <csv> ...")
})().catch((e) => {
    console.error(explain(e))
    process.exitCode = 1
})


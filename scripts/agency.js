#!/usr/bin/env node
// Agency tool: private dedup between agencies over HTTP, then anonymous enrollment + claim cards.
//
// Agency B answers dedup queries (only from agencies registered on-chain for the program):
//   node scripts/agency.js serve  --program 1 --list data/unhcr.csv --port 7001
// Agency A dedups against B, enrolls the households B does not already serve, prints QR claim cards:
//   node scripts/agency.js enroll --program 1 --list data/zakat.csv --peer http://localhost:7001 \
//        --claim-url http://localhost:5173/claim.html --cards cards/zakat.html
//
// CSV columns: name,birthYear,village (quotes allowed). Cards hold claim secrets: keep them offline.
const fs = require("fs")
const path = require("path")
const http = require("http")
const { parseArgs } = require("util")
const { ethers } = require("ethers")
const QRCode = require("qrcode")
const { Identity } = require("@semaphore-protocol/core")
const { Agency } = require("../lib/psi")
const { connect, explain } = require("../lib/chain")
const { readHouseholds: readCsv } = require("../lib/csv")

const MAX_POINTS = 20000 // 10k households × 2 keys; bounds the work an authorised peer can demand
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
        for await (const c of req) if ((raw += c).length > 4e6) return reply(413, { error: "too large" })
        try {
            const { points, ts, signature } = JSON.parse(raw)
            if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS) throw new Error("bad points")
            if (Math.abs(Date.now() - Number(ts)) > FRESH_MS) throw new Error("stale request")
            const from = ethers.verifyMessage(ethers.getBytes(digest(program, ts, points)), signature)
            if (!(await naungan.isAgency(program, from))) return reply(403, { error: `${from} is not an agency of program ${program}` })
            console.log(`${new Date().toISOString()} dedup query from ${from}: ${points.length / 2} records`)
            reply(200, me.respond(points))
        } catch (e) {
            reply(400, { error: e.message })
        }
    }).listen(port, () => console.log(`agency ${wallet.address} answering dedup for program ${program} on :${port} (${me.records.length} households)`))
}

async function enroll({ program, list, peer = [], "claim-url": claimUrl, cards }) {
    const { naungan, wallet } = await connect()
    if (!(await naungan.isAgency(program, wallet.address))) throw new Error(`${wallet.address} is not an agency of program ${program}`)
    const records = readCsv(list)
    const dup = new Set()
    for (const url of peer) {
        const me = new Agency(records)
        const points = me.request()
        const ts = Date.now()
        const signature = await wallet.signMessage(ethers.getBytes(digest(program, ts, points)))
        const res = await fetch(new URL("/psi", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points, ts, signature }) })
        const body = await res.json()
        if (!res.ok) throw new Error(`${url}: ${body.error}`)
        const found = me.intersect(body)
        found.forEach((i) => dup.add(i))
        console.log(`dedup vs ${url}: ${found.size} of ${records.length} already served there`)
    }
    const fresh = records.filter((_, i) => !dup.has(i))
    if (fresh.length === 0) return console.log("nothing to enroll")

    const ids = fresh.map(() => new Identity())
    for (let i = 0; i < ids.length; i += 100) {
        const tx = await naungan.enroll(program, ids.slice(i, i + 100).map((x) => x.commitment))
        await tx.wait()
        console.log(`enrolled ${Math.min(i + 100, ids.length)}/${ids.length} · ${tx.hash}`)
    }

    const meta = JSON.parse(await naungan.metadata(program))
    const cardHtml = await Promise.all(fresh.map(async (r, i) => {
        const link = `${claimUrl}#p=${program}&id=${encodeURIComponent(ids[i].export())}`
        const svg = await QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 1 })
        const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
        return `<article><div class="qr">${svg}</div><div><h2>Naungan claim card</h2><p class="who">${esc(r.name)} · ${esc(r.village)}</p>
<p>${esc(meta.name)}</p><ol><li>Scan with your phone camera.</li><li>When the flood alert opens claims, tap <b>Claim</b>.</li></ol>
<p class="code">No camera? Open ${esc(claimUrl)} and enter: <code>p=${program}&amp;id=${esc(encodeURIComponent(ids[i].export()))}</code></p>
<p class="warn">Keep this card private. Anyone holding it can claim once for this household.</p></div></article>`
    }))
    fs.mkdirSync(path.dirname(cards), { recursive: true })
    fs.writeFileSync(cards, `<!doctype html><meta charset="utf-8"><title>Naungan claim cards</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px}article{display:flex;gap:16px;border:1px solid #999;border-radius:10px;padding:14px;margin:0 0 12px;page-break-inside:avoid;max-width:640px}
.qr{width:180px;flex:none}h2{margin:0 0 4px;font-size:17px}.who{font-weight:600}.warn{color:#b5541c;font-size:12px}ol{padding-left:18px;margin:6px 0}.code{font-size:11px;word-break:break-all}
</style>${cardHtml.join("\n")}`)
    console.log(`wrote ${fresh.length} claim cards → ${cards}`)
}

const { values: a, positionals: [cmd] } = parseArgs({
    allowPositionals: true,
    options: { program: { type: "string" }, list: { type: "string" }, port: { type: "string", default: "7001" }, peer: { type: "string", multiple: true }, "claim-url": { type: "string" }, cards: { type: "string" } }
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


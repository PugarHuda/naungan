#!/usr/bin/env node
// Agency tool: private dedup between agencies over HTTP, then anonymous enrollment + claim cards.
//
// Agency B answers dedup queries (only from agencies registered on-chain for the program):
//   node scripts/agency.js serve  --program 1 --list data/unhcr.csv --port 7001
// Agency A dedups against B, enrolls the households B does not already serve, prints QR claim cards
// (possible matches, birth year one off or a one-letter typo, go to <list>.review.csv instead of being enrolled):
//   node scripts/agency.js enroll --program 1 --list data/zakat.csv --peer http://localhost:7001 \
//        --claim-url http://localhost:5173/claim.html --cards cards/zakat.html [--pin]
//   --names id|basic picks how names are normalised before matching (default id: Indonesian/Malay titles
//   and spelling; basic: accents, case and common honorifics only). Both agencies must use the same one.
//   --pin locks each card with a 6-digit PIN printed on a separate slip (cards/zakat.pins.html). The key also
//   needs the relayer's OPRF (lib/cardlock.mjs v2), so a stolen card cannot be brute-forced offline;
//   --pin-server overrides deployment.json's relayer.
//
// CSV columns: name,birthYear,village (quotes allowed), optional commitment. Cards hold claim secrets: keep them offline.
//
// Self-enrolled households: a phone opened at <claim-url>#join=<program> makes its own identity and shows
// only its commitment (QR "naungan-commitment:<program>:<n>"). Put that in the commitment column: the
// row is enrolled with it and gets no card, so this agency never holds a secret that could recognise
// the household's claim. Rows without one get a printed card, whose secret the agency did see.
const fs = require("fs")
const path = require("path")
const http = require("http")
const { parseArgs } = require("util")
const { ethers } = require("ethers")
const QRCode = require("qrcode")
const { lockV2, newPin } = require("../lib/cardlock.mjs")
const { Identity } = require("@semaphore-protocol/core")
const { Agency, DST, PROFILES, DEFAULT_PROFILE } = require("../lib/psi.mjs")
const { connect, explain } = require("../lib/chain")
const { readHouseholds: readCsv } = require("../lib/csv")

const MAX_POINTS = 300000 // 10k households × ~30 keys (exact, phonetic, year ±1, typo); bounds the work an authorised peer can demand
const FRESH_MS = 5 * 60e3

// The signed payload binds the program, a timestamp and the exact points, so it can't be replayed elsewhere.
const digest = (programId, ts, points) => ethers.solidityPackedKeccak256(["string", "uint256", "uint256", "bytes32"], ["naungan-psi", programId, ts, ethers.id(points.join(","))])

async function serve({ program, list, port, names = DEFAULT_PROFILE }) {
    const { naungan, wallet } = await connect()
    const me = new Agency(readCsv(list), { profile: names })
    http.createServer(async (req, res) => {
        const reply = (code, body) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(body)))
        if (req.method !== "POST" || req.url !== "/psi") return reply(404, { error: "not found" })
        let raw = ""
        for await (const c of req) if ((raw += c).length > 24e6) return reply(413, { error: "too large" })
        try {
            const { points, ts, signature, v, names: theirs = DEFAULT_PROFILE } = JSON.parse(raw)
            if (v !== DST) throw new Error(`peer runs dedup ${v ?? "naungan-psi-v1"}, this agency runs ${DST}: update both to the same release`)
            // Different profiles normalise names differently: every key would differ and dedup would silently find nothing.
            if (theirs !== me.profile) throw new Error(`peer matches names with the "${theirs}" profile, this agency uses "${me.profile}": agree on one (--names)`)
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

/** POST a blinded point to the relayer's /pin; used by lockV2 at issuance (one of the card's tries). */
const pinServer = (base) => async (q) => {
    const res = await fetch(new URL("/pin", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`PIN server ${base}: ${body.error ?? res.status}`)
    return body.evaluated
}

async function enroll({ program, list, peer = [], "claim-url": claimUrl, cards, pin: withPin, "pin-server": pinUrl, names = DEFAULT_PROFILE }) {
    const { naungan, wallet, d } = await connect()
    if (!(await naungan.isAgency(program, wallet.address))) throw new Error(`${wallet.address} is not an agency of program ${program}`)
    const records = readCsv(list, program)
    if (!peer.length) console.warn("no --peer given: this list is NOT deduplicated against any other agency; households another agency already enrolled will be enrolled twice")
    const dup = new Set(), near = new Set()
    for (const url of peer) {
        const me = new Agency(records, { profile: names })
        const points = me.request()
        const ts = Date.now()
        const signature = await wallet.signMessage(ethers.getBytes(digest(program, ts, points)))
        const res = await fetch(new URL("/psi", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points, ts, signature, v: DST, names }) })
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
        fs.writeFileSync(file, "name,birthYear,village,commitment\n" + [...near].map((i) => [records[i].name, records[i].birthYear, records[i].village, records[i].commitment ?? ""].map(q).join(",")).join("\n") + "\n")
        console.log(`held back ${near.size} possible duplicates → ${file} (confirm with the peer agency, then enroll the real new ones from that file without --peer)`)
    }
    const fresh = records.filter((_, i) => !dup.has(i) && !near.has(i))
    if (fresh.length === 0) return console.log("nothing to enroll")

    // Self-enrolled rows bring their commitment; every other row gets a fresh identity and a printed card.
    const carded = fresh.filter((r) => r.commitment === undefined)
    if (carded.length && !(claimUrl && cards)) throw new Error(`${carded.length} rows have no commitment and need printed cards: pass --claim-url and --cards`)
    const onChain = new Set((await naungan.members(program)).map(String))
    for (const r of fresh) if (r.commitment !== undefined && onChain.has(String(r.commitment))) throw new Error(`${r.name}: this phone's commitment is already enrolled in program ${program}`)
    const ids = carded.map(() => new Identity())
    // --pin: the QR holds the secret encrypted under a 6-digit PIN that goes on a separate slip. Cards are
    // locked before anything is enrolled: if the PIN server is down, nobody is enrolled without a card.
    const pins = withPin ? carded.map(newPin) : []
    const ask = withPin && pinServer(pinUrl ?? d.relayer ?? "http://localhost:8788")
    const codes = []
    for (let i = 0; i < ids.length; i++) // one at a time: each lock runs 600k PBKDF2 iterations
        codes.push(withPin ? `p=${program}&e2=${await lockV2(ids[i].export(), pins[i], program, ask)}` : `p=${program}&id=${encodeURIComponent(ids[i].export())}`)
    const commitments = [...fresh.filter((r) => r.commitment !== undefined).map((r) => r.commitment), ...ids.map((x) => x.commitment)]
    for (let i = 0; i < commitments.length; i += 100) {
        const tx = await naungan.enroll(program, commitments.slice(i, i + 100))
        await tx.wait()
        console.log(`enrolled ${Math.min(i + 100, commitments.length)}/${commitments.length} · ${tx.hash}`)
    }
    console.log(`${commitments.length - ids.length} self-enrolled from their own phones (no card, this agency holds no secret), ${ids.length} with printed cards`)
    if (!ids.length) return

    const meta = JSON.parse(await naungan.metadata(program))
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
    const cardHtml = await Promise.all(carded.map(async (r, i) => {
        const code = codes[i]
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
${carded.map((r, i) => `<p>Kartu #${i + 1} · ${esc(r.name)} · ${esc(r.village)}<br>PIN <b>${pins[i]}</b><br>Serahkan terpisah dari kartu. <span lang="en">Hand over separately from the card.</span></p>`).join("\n")}`)
        console.log(`wrote ${carded.length} PIN slips → ${pinFile} (print and hand out apart from the cards)`)
    }
    fs.mkdirSync(path.dirname(cards), { recursive: true })
    fs.writeFileSync(cards, `<!doctype html><html lang="id"><meta charset="utf-8"><title>Kartu klaim Naungan</title><style>[lang=en]{color:#555;font-size:.9em}
body{font:14px/1.4 system-ui,sans-serif;margin:16px}article{display:flex;gap:16px;border:1px solid #999;border-radius:10px;padding:14px;margin:0 0 12px;page-break-inside:avoid;max-width:640px}
.qr{width:180px;flex:none}h2{margin:0 0 4px;font-size:17px}.who{font-weight:600}.warn{color:#b5541c;font-size:12px}ol{padding-left:18px;margin:6px 0}.code{font-size:11px;word-break:break-all}
</style>${cardHtml.join("\n")}`)
    console.log(`wrote ${carded.length} claim cards → ${cards}`)
}

const { values: a, positionals: [cmd] } = parseArgs({
    allowPositionals: true,
    options: { program: { type: "string" }, list: { type: "string" }, port: { type: "string", default: "7001" }, peer: { type: "string", multiple: true }, "claim-url": { type: "string" }, cards: { type: "string" }, pin: { type: "boolean" }, "pin-server": { type: "string" }, names: { type: "string", default: DEFAULT_PROFILE } }
})
const need = (...k) => k.forEach((x) => { if (!a[x]) throw new Error(`--${x} is required`) })

;(async () => {
    need("program", "list")
    if (!PROFILES[a.names]) throw new Error(`--names must be ${Object.keys(PROFILES).join(" or ")}`)
    a.program = BigInt(a.program)
    if (cmd === "serve") return serve({ ...a, port: Number(a.port) })
    if (cmd === "enroll") return enroll(a) // --claim-url and --cards are needed only for rows that get printed cards
    throw new Error("usage: agency.js serve|enroll --program <id> --list <csv> ...")
})().catch((e) => {
    console.error(explain(e))
    process.exitCode = 1
})


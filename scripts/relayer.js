#!/usr/bin/env node
// Gas relayer: households have no ETH, so they send their ZK proof here and the relayer submits it.
// The payout address is bound inside the proof, so the relayer can pay gas but cannot redirect funds.
//
//   node scripts/relayer.js            (PORT=8788)
//   POST /relay  { programId, proof }  → { txHash, payout, amount }
//   POST /transfer { from, to, value, validAfter, validBefore, nonce, signature }  → { txHash }
//        EIP-3009 transferWithAuthorization: a paid household moves its USDC (to a cash-out agent or
//        shop) without ever holding ETH. Only sponsored for addresses Naungan has paid.
//   GET  /health                       → relayer address, balance, chain
const http = require("http")
const { ethers } = require("ethers")
const { connect, explain, logs } = require("../lib/chain")

const PORT = Number(process.env.PORT || 8788)
const PER_MINUTE = Number(process.env.RATE_LIMIT || 10)
const MAX_BODY = 16e3
const uint = (v) => typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? BigInt(v) : NaN

/** Strict shape check at the trust boundary; throws on anything that is not a Semaphore v4 proof. */
function parseProof(body) {
    const { programId, proof } = body ?? {}
    const p = proof ?? {}
    const out = {
        merkleTreeDepth: uint(p.merkleTreeDepth),
        merkleTreeRoot: uint(p.merkleTreeRoot),
        nullifier: uint(p.nullifier),
        message: uint(p.message),
        scope: uint(p.scope),
        points: Array.isArray(p.points) && p.points.length === 8 ? p.points.map(uint) : null
    }
    if (!out.points || [out.merkleTreeDepth, out.merkleTreeRoot, out.nullifier, out.message, out.scope].some((x) => typeof x !== "bigint"))
        throw new Error("malformed proof")
    if (out.merkleTreeDepth < 1n || out.merkleTreeDepth > 32n) throw new Error("merkleTreeDepth out of range")
    const pid = uint(programId)
    if (typeof pid !== "bigint" || pid !== out.scope) throw new Error("programId must equal proof.scope")
    return { pid, proof: out }
}

/** EIP-3009 authorization shape check; the token itself verifies the signature. */
function parseTransfer(body) {
    const b = body ?? {}
    const addr = (x) => { if (typeof x !== "string" || !ethers.isAddress(x)) throw new Error("bad address"); return ethers.getAddress(x) }
    const out = { from: addr(b.from), to: addr(b.to), value: uint(b.value), validAfter: uint(b.validAfter), validBefore: uint(b.validBefore) }
    if ([out.value, out.validAfter, out.validBefore].some((x) => typeof x !== "bigint" || x < 0n)) throw new Error("malformed authorization")
    if (out.value === 0n) throw new Error("value must be positive")
    if (typeof b.nonce !== "string" || !ethers.isHexString(b.nonce, 32)) throw new Error("nonce must be 32 bytes hex")
    if (typeof b.signature !== "string" || !ethers.isHexString(b.signature, 65)) throw new Error("signature must be 65 bytes hex")
    const sig = ethers.Signature.from(b.signature)
    return { ...out, nonce: b.nonce, v: sig.v, r: sig.r, s: sig.s }
}

const revertName = explain

/**
 * The relayer core, independent of the transport: `handle(method, path, ip, raw)` → [status, body].
 * Served by the Node http server below and by the Vercel function in api/relayer.js.
 */
async function createRelayer() {
    const { naungan, wallet, signer, provider, d } = await connect()
    const usdc = new ethers.Contract(d.usdc, ["function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)"], signer)
    const payees = new Set()
    let scanned = (d.fromBlock ?? 0) - 1
    const isPayee = async (a) => { // incremental scan: each Claimed log is read once per relayer run
        if (payees.has(a)) return true
        const head = await provider.getBlockNumber()
        for (const l of await logs(naungan, naungan.filters.Claimed(), scanned + 1, head)) payees.add(ethers.getAddress(l.args.payout))
        scanned = head
        return payees.has(a)
    }
    const hits = new Map()
    let queue = Promise.resolve() // serialise sends: concurrent claims would otherwise reuse a nonce

    const limited = (ip) => {
        const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 60e3)
        recent.push(now)
        hits.set(ip, recent)
        return recent.length > PER_MINUTE
    }
    // The same proof (or authorization) sent twice before the first is mined passes simulation both
    // times, and the second reverts on-chain at the relayer's expense. One in flight per key.
    // Settled keys are remembered too: a load-balanced public RPC can answer the simulation from a node
    // that has not seen our last claim yet, which would let a replayed proof through to revert on-chain.
    const inFlight = new Set(), settled = new Map()
    const send = (key, submit, spentError) => {
        if (settled.has(key)) return Promise.reject(Object.assign(new Error(spentError), { status: 422 }))
        if (inFlight.has(key)) return Promise.reject(Object.assign(new Error("already being submitted"), { status: 409 }))
        inFlight.add(key)
        const job = queue.then(async () => {
            let tx
            try {
                tx = await submit()
            } catch (e) {
                // Another process using this key moved the on-chain nonce: resync once and resend.
                if (e?.code !== "NONCE_EXPIRED" && !/nonce/i.test(e?.message ?? "")) throw e
                signer.reset()
                tx = await submit()
            }
            const rcpt = await tx.wait()
            if (rcpt.status !== 1) throw new Error("transaction reverted")
            return tx.hash
        })
        queue = job.catch(() => signer.reset()) // a failed send leaves the local nonce ahead of the chain
        return job.then((h) => (settled.set(key, h), h)).finally(() => inFlight.delete(key)) // ponytail: in-memory, grows by one entry per payout
    }
    const handle = async (method, url, ip, raw) => {
        if (method === "OPTIONS") return [204, {}]
        if (method === "GET" && url === "/health")
            return [200, { relayer: wallet.address, balance: ethers.formatEther(await provider.getBalance(wallet.address)), chainId: d.chainId, naungan: d.naungan }]
        if (method !== "POST" || !["/relay", "/transfer"].includes(url)) return [404, { error: "not found" }]
        if (limited(ip)) return [429, { error: "too many requests, try again in a minute" }]
        if (raw.length > MAX_BODY) return [413, { error: "body too large" }]
        if (url === "/transfer") {
            let a
            try {
                a = parseTransfer(JSON.parse(raw))
            } catch (e) {
                return [400, { error: e.message }]
            }
            if (!(await isPayee(a.from))) return [403, { error: "only Naungan payout wallets are sponsored" }]
            const args = [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s]
            try {
                await usdc.transferWithAuthorization.staticCall(...args)
            } catch (e) {
                return [422, { error: e.reason ?? revertName(e) }]
            }
            try {
                const txHash = await send(`auth:${a.from}:${a.nonce}`, () => usdc.transferWithAuthorization(...args), "authorization is used or canceled")
                console.log(`${new Date().toISOString()} transfer ${a.from} → ${a.to} ${ethers.formatUnits(a.value, 6)} USDC · ${txHash}`)
                return [200, { txHash }]
            } catch (e) {
                return [e.status ?? 502, { error: e.status ? e.message : revertName(e) }]
            }
        }
        let pid, proof
        try {
            ;({ pid, proof } = parseProof(JSON.parse(raw)))
        } catch (e) {
            return [400, { error: e.message }]
        }
        try {
            await naungan.claim.staticCall(pid, proof) // dry run first: never spend gas on a doomed claim
        } catch (e) {
            return [422, { error: revertName(e) }]
        }
        try {
            const txHash = await send(`claim:${pid}:${proof.nullifier}`, () => naungan.claim(pid, proof), "AlreadyClaimed")
            payees.add(ethers.getAddress(ethers.toBeHex(proof.message, 20)))
            const p = await naungan.programs(pid)
            console.log(`${new Date().toISOString()} program ${pid} paid ${ethers.getAddress(ethers.toBeHex(proof.message, 20))} · ${txHash}`)
            return [200, { txHash, payout: ethers.getAddress(ethers.toBeHex(proof.message, 20)), amount: p.amountPerHousehold.toString() }]
        } catch (e) {
            return [e.status ?? 502, { error: e.status ? e.message : revertName(e) }]
        }
    }
    // An RPC hiccup inside a request must answer 500, not crash the server with an unhandled rejection.
    return { handle: (...a) => handle(...a).catch((e) => [500, { error: revertName(e) }]), wallet, d }
}

const HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }

async function main() {
    const { handle, wallet, d } = await createRelayer()
    http.createServer(async (req, res) => {
        const ip = req.socket.remoteAddress
        let raw = ""
        for await (const chunk of req) if (raw.length <= MAX_BODY) raw += chunk // drain, don't break: breaking destroys the socket
        const [code, body] = await handle(req.method, req.url, ip, raw)
        res.writeHead(code, HEADERS)
        res.end(JSON.stringify(body))
    }).listen(PORT, () => console.log(`relayer ${wallet.address} on ${d.network} · http://localhost:${PORT}`))
}

if (require.main === module) main().catch((e) => (console.error(e.message), process.exit(1)))
module.exports = { parseProof, parseTransfer, createRelayer, HEADERS, MAX_BODY }

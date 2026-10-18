#!/usr/bin/env node
// Gas relayer: households have no ETH, so they send their ZK proof here and the relayer submits it.
// The payout address is bound inside the proof, so the relayer can pay gas but cannot redirect funds.
//
//   node scripts/relayer.js            (PORT=8788)
//   POST /relay  { programId, proof }  → { txHash, payout, amount }
//   POST /transfer { from, to, value, validAfter, validBefore, nonce, signature }  → { txHash }
//        EIP-3009 transferWithAuthorization: a paid household moves its USDC (to a cash-out agent or
//        shop) without ever holding ETH. Only sponsored for addresses Naungan has paid.
//   POST /pin { programId, card, point } → { evaluated, left }
//        OPRF for PIN-locked v2 cards (lib/cardlock.js): evaluates a blinded point, at most MAX_TRIES
//        times per card. The server never sees the PIN, and the phone cannot test one without it.
//   GET  /health                       → relayer address, balance, chain
const http = require("http")
const { ethers } = require("ethers")
const { connect, explain, logs } = require("../lib/chain")
const { oprfKey, evaluate, MAX_TRIES } = require("../lib/cardlock")

const PORT = Number(process.env.PORT || 8788)
const PER_MINUTE = Number(process.env.RATE_LIMIT || 10)
const PIN_PER_MINUTE = 600
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
 * State every relayer instance must share: PIN tries per card, per-IP request counts, and which claims
 * and transfers are in flight or done. Upstash Redis over its REST API when the env is set, so it holds
 * across serverless instances and restarts; otherwise one process's memory, which `/health` reports.
 * Keys carry a TTL (seconds) so the store never fills with old entries.
 */
function sharedStore(env = process.env) {
    const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN
    if (url && token) {
        const run = async (...cmds) => {
            const res = await fetch(`${url}/pipeline`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmds) })
            if (!res.ok) throw new Error(`shared store answered ${res.status}`)
            const out = await res.json()
            const bad = out.find((x) => x.error)
            if (bad) throw new Error(`shared store: ${bad.error}`)
            return out.map((x) => x.result)
        }
        return {
            store: "upstash-redis",
            incr: async (k, ttl) => Number((await run(["INCR", k], ["EXPIRE", k, String(ttl)]))[0]),
            claim: async (k, v, ttl) => (await run(["SET", k, v, "NX", "EX", String(ttl)]))[0] === "OK", // true only for the first caller
            set: async (k, v, ttl) => void (await run(["SET", k, v, "EX", String(ttl)])),
            get: async (k) => (await run(["GET", k]))[0],
            del: async (k) => void (await run(["DEL", k]))
        }
    }
    const m = new Map() // ponytail: one process's memory; expired entries are dropped when read
    const live = (k) => { const e = m.get(k); if (e && e.until < Date.now()) m.delete(k); return m.get(k) }
    const put = (k, v, ttl) => m.set(k, { v, until: Date.now() + ttl * 1e3 })
    return {
        store: "memory",
        incr: async (k, ttl) => { const n = (live(k)?.v ?? 0) + 1; put(k, n, ttl); return n },
        claim: async (k, v, ttl) => (live(k) ? false : (put(k, v, ttl), true)),
        set: async (k, v, ttl) => void put(k, v, ttl),
        get: async (k) => live(k)?.v ?? null,
        del: async (k) => void m.delete(k)
    }
}
const YEAR = 31536000, MONTH = 2592000

/** /pin request: validated before anything is counted, so garbage never burns a household's tries. */
function parsePin(body) {
    const b = body ?? {}
    if (typeof b.programId !== "string" || !/^[0-9]{1,20}$/.test(b.programId)) throw new Error("programId must be a decimal string")
    if (typeof b.card !== "string" || !/^[0-9a-f]{32}$/.test(b.card)) throw new Error("card must be 16 bytes hex")
    return { programId: b.programId, card: b.card, point: b.point }
}

/**
 * The relayer core, independent of the transport: `handle(method, path, ip, raw)` → [status, body].
 * Served by the Node http server below and by the Vercel function in api/relayer.js.
 */
async function createRelayer({ store = sharedStore() } = {}) {
    const { naungan, wallet, signer, provider, d } = await connect()
    const pinSeed = wallet.privateKey // rotating the relayer key invalidates v2 cards
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

    // Per-minute window in the shared store, so a client cannot multiply its quota by landing on more
    // instances; if the store is unreachable, this instance's own sliding window still applies.
    const limited = async (key, max = PER_MINUTE) => {
        try {
            return (await store.incr(`naungan:rl:${key}:${Math.floor(Date.now() / 60e3)}`, 120)) > max
        } catch {
            const now = Date.now(), recent = (hits.get(key) ?? []).filter((t) => now - t < 60e3)
            recent.push(now)
            hits.set(key, recent)
            return recent.length > max
        }
    }
    // The same proof (or authorization) sent twice before the first is mined passes simulation both
    // times, and the second reverts on-chain at the relayer's expense. One in flight per key.
    // Settled keys are remembered too: a load-balanced public RPC can answer the simulation from a node
    // that has not seen our last claim yet, which would let a replayed proof through to revert on-chain.
    // Both sets live in the shared store too: another instance may hold the same proof right now.
    const inFlight = new Set(), settled = new Map()
    const send = async (key, submit, spentError) => {
        if (settled.has(key)) throw Object.assign(new Error(spentError), { status: 422 })
        if (inFlight.has(key)) throw Object.assign(new Error("already being submitted"), { status: 409 })
        const lock = `naungan:relay:${key}`
        if (!(await store.claim(lock, "pending", 300))) {
            const v = await store.get(lock)
            throw /^0x/.test(v ?? "") ? Object.assign(new Error(spentError), { status: 422 }) : Object.assign(new Error("already being submitted"), { status: 409 })
        }
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
        try {
            const h = await job
            settled.set(key, h) // ponytail: in-memory copy, grows by one entry per payout
            await store.set(lock, h, MONTH).catch(() => {}) // the chain itself rejects a replay after this anyway
            return h
        } catch (e) {
            await store.del(lock).catch(() => {}) // failed: let the household retry
            throw e
        } finally {
            inFlight.delete(key)
        }
    }
    const handle = async (method, url, ip, raw) => {
        if (method === "OPTIONS") return [204, {}]
        if (method === "GET" && url === "/health")
            return [200, { relayer: wallet.address, balance: ethers.formatEther(await provider.getBalance(wallet.address)), chainId: d.chainId, naungan: d.naungan, pinStore: store.store, pinTries: MAX_TRIES }]
        // A loose per-IP limit (an agency issues hundreds of cards at once); the per-card cap is the real bound.
        if (method === "POST" && url === "/pin") {
            if (await limited(`pin:${ip}`, PIN_PER_MINUTE)) return [429, { error: "too many requests, try again in a minute" }]
            if (raw.length > 1e3) return [413, { error: "body too large" }]
            let q, evaluated
            try {
                q = parsePin(JSON.parse(raw))
                evaluated = evaluate(await oprfKey(pinSeed, q.programId, q.card), q.point) // key bound to the counted card
            } catch (e) {
                return [400, { error: e.message }]
            }
            const n = await store.incr(`naungan:pin:${q.programId}:${q.card}`, YEAR) // prefixed: the store may be shared with other apps
            if (n > MAX_TRIES) return [429, { error: "this card is locked after too many PIN attempts: ask your agency for a new card", left: 0 }]
            return [200, { evaluated, left: MAX_TRIES - n }]
        }
        if (method !== "POST" || !["/relay", "/transfer"].includes(url)) return [404, { error: "not found" }]
        if (await limited(ip)) return [429, { error: "too many requests, try again in a minute" }]
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
module.exports = { parseProof, parseTransfer, parsePin, sharedStore, createRelayer, HEADERS, MAX_BODY }

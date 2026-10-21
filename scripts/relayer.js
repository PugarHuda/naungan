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
//        OPRF for PIN-locked v2 cards (lib/cardlock.mjs): evaluates a blinded point, at most MAX_TRIES
//        times per card. The server never sees the PIN, and the phone cannot test one without it.
//   GET  /push-key → { key }       POST /subscribe { programId, endpoint } → { ok }
//   POST /notify → { programs, sent }
//        Web Push "claims are open" (lib/push.js): a phone leaves only its push endpoint per program; when a
//        trigger fires, /notify wakes those phones once and forgets them. Idempotent, so anyone may call it
//        (the oracle workflow does after every run).
//   GET  /oracle → { reported }
//        Backup scheduler for the hosted oracle (a Vercel cron): GitHub delays and drops scheduled runs. Reports
//        only on programs this key has not reported on for ORACLE_EVERY hours, one run at a time, so a caller
//        can never make it report more often than the schedule would; anyone may call it.
//   GET  /health                       → relayer address, balance, chain
const http = require("http")
const { ethers } = require("ethers")
const { connect, explain, logs } = require("../lib/chain")
const push = require("../lib/push")

const PORT = Number(process.env.PORT || 8788)
const PER_MINUTE = Number(process.env.RATE_LIMIT || 10)
const PIN_PER_MINUTE = 600
const MAX_BODY = 16e3
const ORACLE_EVERY = 5.5 // hours, as the GitHub workflow's --every
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
    if (!out.points || [out.merkleTreeDepth, out.merkleTreeRoot, out.nullifier, out.message, out.scope, ...out.points].some((x) => typeof x !== "bigint" || x < 0n || x >= 2n ** 256n))
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
 * Status for a failed dry run. Only the contract's own verdicts are final (422: the phone drops the proof);
 * anything else (RPC timeout, 429, a lagging node that has not seen the group's root yet) is 503, so a
 * queued claim is kept and retried instead of silently deleted.
 */
const FINAL = new Set(["AlreadyClaimed", "Underfunded", "WrongScope", "BadPayout", "ClaimWindowClosed", "NotTriggered", "UnknownProgram"])
const claimStatus = (name) => (FINAL.has(name) ? 422 : 503)
/** USDC reverts with a reason string ("FiatTokenV2: invalid signature"); no reason means the RPC failed, not the authorization. */
const transferStatus = (e) => (e?.reason ? 422 : 503)
const MIN_SPONSORED = 10_000n // 0.01 USDC: below this a sponsored transfer only burns the relayer's gas
const DAILY_TRANSFERS = 20 // per payout wallet: a household paying shops, not a script draining gas

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
            del: async (k) => void (await run(["DEL", k])),
            // Delete only while we still hold it: a lock that outlived its TTL may belong to the next caller now.
            release: async (k, v) => void (await run(["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", "1", k, v])),
            add: async (k, v, ttl) => void (await run(["SADD", k, v], ["EXPIRE", k, String(ttl)])),
            members: async (k) => (await run(["SMEMBERS", k]))[0] ?? [],
            pop: async (k, n) => (await run(["SPOP", k, String(n)]))[0] ?? [] // up to n members, removed as they are read
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
        del: async (k) => void m.delete(k),
        release: async (k, v) => void (live(k)?.v === v && m.delete(k)),
        add: async (k, v, ttl) => void put(k, new Set(live(k)?.v).add(v), ttl),
        members: async (k) => [...(live(k)?.v ?? [])],
        pop: async (k, n) => { const e = live(k); const out = [...(e?.v ?? [])].slice(0, n); for (const x of out) e.v.delete(x); return out }
    }
}
const YEAR = 31536000, MONTH = 2592000

/**
 * Wake every phone queued under `key`, `batch` at a time. Each batch is popped from the shared store before it is
 * sent, so two senders never wake one phone twice and a sender cut off by its time limit loses nothing: it stops at
 * `deadline` (ms) and what is left stays queued for the next call. A phone whose push service answered 429, 5xx or
 * nothing goes back in the queue for next time; any other answer (404/410: the phone unsubscribed) drops it.
 */
async function drain(store, key, wake, { batch = 200, deadline = Infinity, ttl = MONTH } = {}) {
    let woke = 0, more = false
    const retry = []
    for (;;) {
        if (Date.now() >= deadline) {
            more = true
            break
        }
        const subs = await store.pop(key, batch)
        if (!subs.length) break
        for (let i = 0; i < subs.length; i += 50) {
            const codes = await Promise.all(subs.slice(i, i + 50).map((e) => wake(e).catch(() => 0)))
            codes.forEach((c, j) => (c >= 200 && c < 300 ? woke++ : (c === 0 || c === 429 || c >= 500) && retry.push(subs[i + j])))
        }
    }
    for (const e of retry) await store.add(key, e, ttl)
    return { woke, retried: retry.length, more }
}
// PIN try counters must outlive any card: a stolen card left in a drawer must not earn fresh guesses.
const PIN_TTL = 10 * YEAR

/** /pin request: validated before anything is counted, so garbage never burns a household's tries. */
function parsePin(body) {
    const b = body ?? {}
    if (typeof b.programId !== "string" || !/^[0-9]{1,20}$/.test(b.programId)) throw new Error("programId must be a decimal string")
    if (typeof b.card !== "string" || !/^[0-9a-f]{32}$/.test(b.card)) throw new Error("card must be 16 bytes hex")
    return { programId: b.programId, card: b.card, point: b.point }
}

// One nonce sequence for the relayer key, shared by every instance: a store lock serialises
// submissions, and the next nonce is kept in the store as well, because a load-balanced public RPC can
// still report the pending count from before our last send. The stored nonce expires after two
// minutes, so a transaction the network dropped leaves a gap for at most that long.
function serialSender(store, provider, address) {
    const NONCE = `naungan:nonce:${address}`, LOCK = `naungan:sendlock:${address}`
    return async (send) => {
        const me = ethers.hexlify(ethers.randomBytes(8))
        for (let t = 0; !(await store.claim(LOCK, me, 30)); t++) {
            if (t >= 50) throw Object.assign(new Error("relayer busy, try again shortly"), { status: 503 })
            await new Promise((r) => setTimeout(r, 200 + Math.random() * 200))
        }
        try {
            const next = async () => Math.max(await provider.getTransactionCount(address, "pending"), Number((await store.get(NONCE)) ?? 0))
            let nonce = await next(), tx
            try {
                tx = await send({ nonce })
            } catch (e) {
                // Someone else (a CLI run with the same key) moved the chain's nonce: drop ours and resync once.
                if (e?.code !== "NONCE_EXPIRED" && !/nonce/i.test(e?.message ?? "")) throw e
                await store.del(NONCE)
                tx = await send({ nonce: (nonce = await next()) })
            }
            await store.set(NONCE, String(nonce + 1), 120)
            return tx
        } finally {
            await store.release(LOCK, me).catch(() => {})
        }
    }
}

/**
 * The relayer core, independent of the transport: `handle(method, path, ip, raw)` → [status, body].
 * Served by the Node http server below and by the Vercel function in api/relayer.js.
 */
async function createRelayer({ store = sharedStore() } = {}) {
    // lib/cardlock.mjs is an ES module shared with the browser: import() loads it on any Node version
    // (require() of ESM needs 22.12+, and the serverless runtime may be older).
    const { oprfKey, evaluate, MAX_TRIES } = await import("../lib/cardlock.mjs")
    const { naungan: reader, wallet, provider, d } = await connect()
    // Sends go out from the bare wallet with an explicit nonce (see `submit`), never through the NonceManager.
    const naungan = reader.connect(wallet)
    const pinSeed = wallet.privateKey // rotating the relayer key invalidates v2 cards
    const usdc = new ethers.Contract(d.usdc, ["function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)"], wallet)
    // Payout wallets are remembered in the shared store as they are found, so a cold serverless instance
    // answers a known payee from one store read instead of rescanning every Claimed log since deployment.
    const payees = new Set()
    let scanned = (d.fromBlock ?? 0) - 1
    const payeeKey = (a) => `naungan:payee:${d.naungan}:${a}`
    const isPayee = async (a) => {
        if (payees.has(a)) return true
        if (await store.get(payeeKey(a)).catch(() => null)) return payees.add(a), true
        const head = await provider.getBlockNumber() // incremental scan: each Claimed log is read once per instance
        const found = (await logs(naungan, naungan.filters.Claimed(), scanned + 1, head)).map((l) => ethers.getAddress(l.args.payout))
        for (const p of found) payees.add(p)
        await Promise.all(found.map((p) => store.set(payeeKey(p), "1", 10 * YEAR))).catch(() => {})
        scanned = head
        return payees.has(a)
    }
    const hits = new Map()

    const submit = serialSender(store, provider, wallet.address)
    const vapid = push.vapidKeys(wallet.privateKey)
    const pushKey = (pid) => `naungan:push:${d.naungan}:${pid}`

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
    const send = async (key, build, spentError) => {
        if (settled.has(key)) throw Object.assign(new Error(spentError), { status: 422 })
        if (inFlight.has(key)) throw Object.assign(new Error("already being submitted"), { status: 409 })
        const lock = `naungan:relay:${key}`
        if (!(await store.claim(lock, "pending", 300))) {
            const v = await store.get(lock)
            throw /^0x/.test(v ?? "") ? Object.assign(new Error(spentError), { status: 422 }) : Object.assign(new Error("already being submitted"), { status: 409 })
        }
        inFlight.add(key)
        try {
            const tx = await submit(build) // only the submission holds the lock; mining is awaited outside it
            const rcpt = await tx.wait()
            if (rcpt.status !== 1) throw new Error("transaction reverted")
            const h = tx.hash
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
        if (method === "GET" && url === "/health") {
            const bal = await provider.getBalance(wallet.address)
            // lowGas: under ~50 sponsored claims left; uptime monitors can alert on it.
            return [200, { relayer: wallet.address, balance: ethers.formatEther(bal), lowGas: bal < ethers.parseEther("0.01"), chainId: d.chainId, naungan: d.naungan, pinStore: store.store, pinTries: MAX_TRIES }]
        }
        if (method === "GET" && url === "/push-key") return [200, { key: vapid.publicKey }]
        if (method === "POST" && url === "/subscribe") {
            if (await limited(`sub:${ip}`)) return [429, { error: "too many requests, try again in a minute" }]
            if (raw.length > 2e3) return [413, { error: "body too large" }]
            let b
            try {
                b = JSON.parse(raw)
            } catch {
                return [400, { error: "body must be JSON" }]
            }
            if (typeof b?.programId !== "string" || !/^[1-9][0-9]{0,8}$/.test(b.programId)) return [400, { error: "programId must be a program id" }]
            if (!push.validEndpoint(b.endpoint)) return [400, { error: "endpoint must be a browser push service URL" }]
            const p = await naungan.programs(b.programId)
            if (p.amountPerHousehold === 0n) return [404, { error: "UnknownProgram" }]
            if (p.claimDeadline > 0n) return [409, { error: "claims are already open for this program" }]
            await store.add(pushKey(b.programId), b.endpoint, Number(p.seasonEnd) - Math.floor(Date.now() / 1000) + MONTH)
            return [200, { ok: true }]
        }
        // Wakes every phone waiting on a program whose claims are open, then forgets them: a phone gets one push
        // per opt-in, so calling this again (by anyone) sends nothing new.
        if ((method === "POST" || method === "GET") && url === "/notify") {
            if (await limited(`notify:${ip}`, 6)) return [429, { error: "too many requests, try again in a minute" }]
            const now = BigInt(Math.floor(Date.now() / 1000))
            const n = Number(await naungan.programCount())
            const open = [], seasonEnd = {}
            for (let pid = 1; pid <= n; pid++) {
                const p = await naungan.programs(pid)
                if (p.claimDeadline > 0n && now <= p.claimDeadline) open.push(pid), (seasonEnd[pid] = Number(p.seasonEnd))
            }
            // One sender at a time across instances, so two callers never both read a list before it is forgotten.
            const lock = `naungan:notifying:${d.naungan}`
            const me = ethers.hexlify(ethers.randomBytes(8))
            if (!(await store.claim(lock, me, 300))) return [409, { error: "already notifying, try again in a minute" }]
            // Stop well inside the function's 300 s; phones not reached yet stay queued for the next call (the oracle
            // workflow calls hourly, the Vercel cron daily), so a program of any size is woken over successive calls.
            const deadline = Date.now() + 240e3
            let sent = 0, more = false
            try {
                for (const pid of open) {
                    const r = await drain(store, pushKey(pid), (e) => push.wake(e, vapid, "https://naungan.vercel.app"), { deadline, ttl: seasonEnd[pid] - Number(now) + MONTH })
                    if (r.woke || r.retried) console.log(`${new Date().toISOString()} program ${pid}: woke ${r.woke} phones, ${r.retried} to retry${r.more ? ", more queued" : ""}`)
                    ;(sent += r.woke), (more ||= r.more)
                }
            } finally {
                await store.release(lock, me).catch(() => {})
            }
            return [200, { programs: open, sent, more }]
        }
        if (method === "GET" && url === "/oracle") {
            if (await limited(`oracle:${ip}`, 2)) return [429, { error: "too many requests, try again in a minute" }]
            const lock = `naungan:oracle:${d.naungan}`
            const me = ethers.hexlify(ethers.randomBytes(8))
            if (!(await store.claim(lock, me, 300))) return [409, { error: "an oracle run is in progress" }]
            try {
                const { reportAll } = require("./oracle")
                return [200, { reported: await reportAll({ naungan, wallet, send: submit }, ORACLE_EVERY) }]
            } finally {
                await store.release(lock, me).catch(() => {})
            }
        }
        // A loose per-IP limit (an agency issues hundreds of cards at once); the per-card cap is the real bound.
        if (method === "POST" && url === "/pin") {
            if (await limited(`pin:${ip}`, PIN_PER_MINUTE)) return [429, { error: "too many requests, try again in a minute" }]
            if (raw.length > 1e3) return [413, { error: "body too large" }]
            // Serverless instances each have their own memory: without the shared store the try cap is not enforced.
            if (store.store === "memory" && process.env.VERCEL) return [503, { error: "PIN service is not configured (no shared store)" }]
            let q, evaluated
            try {
                q = parsePin(JSON.parse(raw))
                evaluated = evaluate(await oprfKey(pinSeed, q.programId, q.card), q.point) // key bound to the counted card
            } catch (e) {
                return [400, { error: e.message }]
            }
            const n = await store.incr(`naungan:pin:${q.programId}:${q.card}`, PIN_TTL) // prefixed: the store may be shared with other apps
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
            if (a.value < MIN_SPONSORED) return [400, { error: "the smallest sponsored transfer is 0.01 USDC" }]
            if (await limited(`from:${a.from}`, 3)) return [429, { error: "too many transfers from this wallet, try again in a minute" }]
            if (!(await isPayee(a.from))) return [403, { error: "only Naungan payout wallets are sponsored" }]
            if ((await store.incr(`naungan:tx:${a.from}:${Math.floor(Date.now() / 864e5)}`, 2 * 86400)) > DAILY_TRANSFERS)
                return [429, { error: `this wallet used its ${DAILY_TRANSFERS} free transfers for today` }]
            const args = [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s]
            try {
                await usdc.transferWithAuthorization.staticCall(...args)
            } catch (e) {
                return [transferStatus(e), { error: e.reason ?? revertName(e) }]
            }
            try {
                const txHash = await send(`auth:${a.from}:${a.nonce}`, (o) => usdc.transferWithAuthorization(...args, o), "authorization is used or canceled")
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
        const key = `claim:${pid}:${proof.nullifier}`
        // A household whose phone lost our answer retries and hits AlreadyClaimed: if we sent that claim,
        // answer with the original payout instead of an error, so the phone shows "paid", not "failed".
        const paidBefore = async () => {
            const h = settled.get(key) ?? (await store.get(`naungan:relay:${key}`).catch(() => null))
            if (!/^0x[0-9a-f]{64}$/i.test(h ?? "")) return null
            const rcpt = await provider.getTransactionReceipt(h)
            const ev = rcpt?.logs.map((l) => { try { return naungan.interface.parseLog(l) } catch { return null } }).find((x) => x?.name === "Claimed" && x.args.nullifier === proof.nullifier)
            if (!ev) return null
            const p = await naungan.programs(pid)
            return { txHash: h, payout: ev.args.payout, amount: p.amountPerHousehold.toString(), already: true }
        }
        try {
            await naungan.claim.staticCall(pid, proof) // dry run first: never spend gas on a doomed claim
        } catch (e) {
            const name = revertName(e)
            const paid = name === "AlreadyClaimed" && (await paidBefore())
            return paid ? [200, paid] : [claimStatus(name), { error: name }]
        }
        try {
            const txHash = await send(key, (o) => naungan.claim(pid, proof, o), "AlreadyClaimed")
            const payout = ethers.getAddress(ethers.toBeHex(proof.message, 20))
            payees.add(payout)
            await store.set(payeeKey(payout), "1", 10 * YEAR).catch(() => {})
            const p = await naungan.programs(pid)
            console.log(`${new Date().toISOString()} program ${pid} paid ${ethers.getAddress(ethers.toBeHex(proof.message, 20))} · ${txHash}`)
            return [200, { txHash, payout: ethers.getAddress(ethers.toBeHex(proof.message, 20)), amount: p.amountPerHousehold.toString() }]
        } catch (e) {
            const paid = e.status === 422 && (await paidBefore().catch(() => null))
            return paid ? [200, paid] : [e.status ?? 502, { error: e.status ? e.message : revertName(e) }]
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
module.exports = { drain, parseProof, parseTransfer, parsePin, sharedStore, createRelayer, serialSender, claimStatus, transferStatus, HEADERS, MAX_BODY }

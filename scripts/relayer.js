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

async function main() {
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
    const send = (submit) => {
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
        return job
    }
    const reply = (res, code, body) => {
        res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" })
        res.end(JSON.stringify(body))
    }

    http.createServer(async (req, res) => {
        if (req.method === "OPTIONS") return reply(res, 204, {})
        if (req.method === "GET" && req.url === "/health")
            return reply(res, 200, { relayer: wallet.address, balance: ethers.formatEther(await provider.getBalance(wallet.address)), chainId: d.chainId, naungan: d.naungan })
        if (req.method !== "POST" || !["/relay", "/transfer"].includes(req.url)) return reply(res, 404, { error: "not found" })
        if (limited(req.socket.remoteAddress)) return reply(res, 429, { error: "too many requests, try again in a minute" })

        let raw = ""
        for await (const chunk of req) {
            raw += chunk
            if (raw.length > 16e3) return reply(res, 413, { error: "body too large" })
        }
        if (req.url === "/transfer") {
            let a
            try {
                a = parseTransfer(JSON.parse(raw))
            } catch (e) {
                return reply(res, 400, { error: e.message })
            }
            if (!(await isPayee(a.from))) return reply(res, 403, { error: "only Naungan payout wallets are sponsored" })
            const args = [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s]
            try {
                await usdc.transferWithAuthorization.staticCall(...args)
            } catch (e) {
                return reply(res, 422, { error: e.reason ?? revertName(e) })
            }
            try {
                const txHash = await send(() => usdc.transferWithAuthorization(...args))
                console.log(`${new Date().toISOString()} transfer ${a.from} → ${a.to} ${ethers.formatUnits(a.value, 6)} USDC · ${txHash}`)
                return reply(res, 200, { txHash })
            } catch (e) {
                return reply(res, 502, { error: revertName(e) })
            }
        }
        let pid, proof
        try {
            ;({ pid, proof } = parseProof(JSON.parse(raw)))
        } catch (e) {
            return reply(res, 400, { error: e.message })
        }
        try {
            await naungan.claim.staticCall(pid, proof) // dry run first: never spend gas on a doomed claim
        } catch (e) {
            return reply(res, 422, { error: revertName(e) })
        }
        try {
            const txHash = await send(() => naungan.claim(pid, proof))
            payees.add(ethers.getAddress(ethers.toBeHex(proof.message, 20)))
            const p = await naungan.programs(pid)
            console.log(`${new Date().toISOString()} program ${pid} paid ${ethers.getAddress(ethers.toBeHex(proof.message, 20))} · ${txHash}`)
            reply(res, 200, { txHash, payout: ethers.getAddress(ethers.toBeHex(proof.message, 20)), amount: p.amountPerHousehold.toString() })
        } catch (e) {
            reply(res, 502, { error: revertName(e) })
        }
    }).listen(PORT, () => console.log(`relayer ${wallet.address} on ${d.network} · http://localhost:${PORT}`))
}

if (require.main === module) main().catch((e) => (console.error(e.message), process.exit(1)))
module.exports = { parseProof, parseTransfer }

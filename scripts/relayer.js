#!/usr/bin/env node
// Gas relayer: households have no ETH, so they send their ZK proof here and the relayer submits it.
// The payout address is bound inside the proof, so the relayer can pay gas but cannot redirect funds.
//
//   node scripts/relayer.js            (PORT=8788)
//   POST /relay  { programId, proof }  → { txHash, payout, amount }
//   GET  /health                       → relayer address, balance, chain
const http = require("http")
const { ethers } = require("ethers")
const { connect, explain } = require("../lib/chain")

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

const revertName = explain

async function main() {
    const { naungan, wallet, signer, provider, d } = await connect()
    const hits = new Map()
    let queue = Promise.resolve() // serialise sends: concurrent claims would otherwise reuse a nonce

    const limited = (ip) => {
        const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 60e3)
        recent.push(now)
        hits.set(ip, recent)
        return recent.length > PER_MINUTE
    }
    const reply = (res, code, body) => {
        res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" })
        res.end(JSON.stringify(body))
    }

    http.createServer(async (req, res) => {
        if (req.method === "OPTIONS") return reply(res, 204, {})
        if (req.method === "GET" && req.url === "/health")
            return reply(res, 200, { relayer: wallet.address, balance: ethers.formatEther(await provider.getBalance(wallet.address)), chainId: d.chainId, naungan: d.naungan })
        if (req.method !== "POST" || req.url !== "/relay") return reply(res, 404, { error: "not found" })
        if (limited(req.socket.remoteAddress)) return reply(res, 429, { error: "too many requests, try again in a minute" })

        let raw = ""
        for await (const chunk of req) {
            raw += chunk
            if (raw.length > 16e3) return reply(res, 413, { error: "body too large" })
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
        const job = queue.then(async () => {
            let tx
            try {
                tx = await naungan.claim(pid, proof)
            } catch (e) {
                // Another process using this key moved the on-chain nonce: resync once and resend.
                if (e?.code !== "NONCE_EXPIRED" && !/nonce/i.test(e?.message ?? "")) throw e
                signer.reset()
                tx = await naungan.claim(pid, proof)
            }
            const rcpt = await tx.wait()
            if (rcpt.status !== 1) throw new Error("claim transaction reverted")
            return tx.hash
        })
        queue = job.catch(() => signer.reset()) // a failed send leaves the local nonce ahead of the chain
        try {
            const txHash = await job
            const p = await naungan.programs(pid)
            console.log(`${new Date().toISOString()} program ${pid} paid ${ethers.getAddress(ethers.toBeHex(proof.message, 20))} · ${txHash}`)
            reply(res, 200, { txHash, payout: ethers.getAddress(ethers.toBeHex(proof.message, 20)), amount: p.amountPerHousehold.toString() })
        } catch (e) {
            reply(res, 502, { error: revertName(e) })
        }
    }).listen(PORT, () => console.log(`relayer ${wallet.address} on ${d.network} · http://localhost:${PORT}`))
}

if (require.main === module) main().catch((e) => (console.error(e.message), process.exit(1)))
module.exports = { parseProof }

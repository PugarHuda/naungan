// Shared plumbing for the off-chain services (oracle, relayer, agency CLI): reads web/deployment.json,
// the compiled ABI and PRIVATE_KEY from the environment or .env.
const fs = require("fs")
const path = require("path")
const { ethers } = require("ethers")

const ROOT = path.join(__dirname, "..")
try {
    process.loadEnvFile(path.join(ROOT, ".env"))
} catch {}

const deployment = () => JSON.parse(fs.readFileSync(path.join(ROOT, "web", "deployment.json"), "utf8"))
const abi = (name, dir = "contracts") => {
    const file = path.join(ROOT, "artifacts", dir, `${name}.sol`, `${name}.json`)
    if (!fs.existsSync(file)) throw new Error("Contracts not compiled: run `npx hardhat compile`")
    return JSON.parse(fs.readFileSync(file, "utf8")).abi
}

// A load-balanced public RPC (sepolia.base.org) now and then answers a contract read with empty data or a data-less error, which
// ethers reports as "missing revert data" though nothing reverted. Our reads always return data, so ask again,
// twice at most. Batches that send a transaction are never repeated. web/src/shared/chain.ts has the same.
class SteadyProvider extends ethers.JsonRpcProvider {
    async _send(payload) {
        const list = [payload].flat()
        for (let i = 0; ; i++) {
            const out = await super._send(payload)
            // Empty data, or an error with no revert data (a real revert of ours carries data): the node, not the contract.
            const empty = out.some((r) => (r.result === "0x" || ("error" in r && r.error && !r.error.data)) && list.find((p) => p.id === r.id)?.method === "eth_call")
            if (!empty || i >= 2 || list.some((p) => p.method === "eth_sendRawTransaction")) return out
            await new Promise((r) => setTimeout(r, 300 * (i + 1)))
        }
    }
}

async function connect() {
    const d = deployment()
    const provider = new SteadyProvider(d.rpc, d.chainId, { staticNetwork: true })
    if (!process.env.PRIVATE_KEY) throw new Error("Set PRIVATE_KEY in .env")
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    // ponytail: on a local Hardhat node the .env wallet starts empty, so give it dev ETH
    if (d.chainId === 31337 && (await provider.getBalance(wallet.address)) === 0n)
        await provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"])
    // NonceManager: back-to-back sends from one process (approve → fund, relayed claims) otherwise
    // read a stale pending nonce from the RPC and fail with "nonce has already been used".
    const signer = new ethers.NonceManager(wallet)
    const naungan = new ethers.Contract(d.naungan, abi("Naungan"), signer)
    return { d, provider, wallet, signer, naungan }
}

/**
 * Event history from a Blockscout indexer (one request per 1000 events, no block-range cap), parsed into
 * the same {args, fragment, blockNumber, index, transactionHash} shape as ethers' EventLog.
 */
async function indexed(indexer, contract, fromBlock, toBlock) {
    const out = [], seen = new Set()
    for (let b = fromBlock; ; ) {
        const r = await (await fetch(`${indexer}?module=logs&action=getLogs&fromBlock=${b}&toBlock=${toBlock}&address=${contract.target}`)).json()
        if (r.status !== "1" && !/no records/i.test(r.message ?? "")) throw new Error(`indexer: ${r.message}`)
        const rows = Array.isArray(r.result) ? r.result : []
        for (const l of rows) {
            const key = l.transactionHash + l.logIndex
            if (seen.has(key)) continue
            seen.add(key)
            const p = contract.interface.parseLog({ topics: l.topics.filter(Boolean), data: l.data })
            if (p) out.push({ args: p.args, fragment: p.fragment, topics: l.topics.filter(Boolean), blockNumber: Number(l.blockNumber), index: Number(l.logIndex), transactionHash: l.transactionHash, timestamp: Number(l.timeStamp) })
        }
        if (rows.length < 1000) return out
        b = Number(rows.at(-1).blockNumber) // the boundary block is read again; `seen` drops the repeats
    }
}

/**
 * Event history from public RPCs that serve eth_getLogs over wide ranges (deployment.json `logRpcs`; Base's own RPC
 * caps it at 200 blocks). Each log carries its blockTimestamp, so no block reads. The span halves when a node refuses it.
 */
async function wideLogs(urls, contract, fromBlock, toBlock, topics) {
    for (const url of urls ?? []) {
        try {
            const out = []
            for (let b = fromBlock, span = 100_000; b <= toBlock; ) {
                const to = Math.min(b + span - 1, toBlock)
                const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15e3), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: contract.target, topics, fromBlock: "0x" + b.toString(16), toBlock: "0x" + to.toString(16) }] }) })
                const r = await res.json()
                if (r.error) {
                    if (span <= 1000) throw new Error(r.error.message)
                    span = Math.floor(span / 2) // "exceed maximum block range": ask for less
                    continue
                }
                for (const l of r.result) {
                    if (l.blockTimestamp == null) throw new Error("logs without blockTimestamp")
                    const p = contract.interface.parseLog({ topics: l.topics, data: l.data })
                    if (p) out.push({ args: p.args, fragment: p.fragment, topics: l.topics, blockNumber: Number(l.blockNumber), index: Number(l.logIndex), transactionHash: l.transactionHash, timestamp: Number(l.blockTimestamp) })
                }
                b = to + 1
            }
            return out
        } catch (e) {
            console.warn(`${new URL(url).host}: ${e.message}; trying the next source`)
        }
    }
    return null
}

/**
 * Everything the contract logged from `fromBlock`, from the fastest source that answers: a wide-range RPC (up to the
 * head), else the indexer (up to 200 blocks behind, its lag margin). Returns null if neither does; callers then read
 * the RPC in 200-block windows from `upTo + 1`.
 */
async function history(contract, fromBlock, toBlock) {
    const d = deployment()
    const wide = await wideLogs(d.logRpcs, contract, fromBlock, toBlock)
    if (wide) return { events: wide, upTo: toBlock }
    if (!d.indexer) return null
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return { events: await indexed(d.indexer, contract, fromBlock, toBlock - 200), upTo: toBlock - 200 }
        } catch (e) {
            console.warn(`${e.message}; retrying`)
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        }
    }
    return null
}

/** eth_getLogs topic semantics: each position is null (any) or a list of accepted values. */
const topicsMatch = (want, topics) => want.every((t, i) => t == null || [t].flat().some((x) => x.toLowerCase() === topics[i]?.toLowerCase()))

/**
 * Logs matching `filter`. Public RPCs (Base Sepolia included) cap eth_getLogs at 200 blocks, so a scan
 * from the deploy block grows by ~216 requests a day. With an indexer in deployment.json, history comes
 * from it and only the newest 200 blocks (indexer lag margin) from the RPC; without one, or if it fails,
 * the RPC is read in 200-block windows.
 */
async function logs(contract, filter, fromBlock, toBlock) {
    toBlock ??= await contract.runner.provider.getBlockNumber()
    const out = []
    if (toBlock - fromBlock > 200) {
        const h = await history(contract, fromBlock, toBlock)
        if (h) {
            // Every topic position the filter pins (event signature and indexed args such as programId) must match.
            const want = await filter.getTopicFilter()
            out.push(...h.events.filter((e) => topicsMatch(want, e.topics)))
            fromBlock = h.upTo + 1
        }
    }
    for (let b = fromBlock; b <= toBlock; b += 200) out.push(...(await contract.queryFilter(filter, b, Math.min(b + 199, toBlock))))
    return out
}

/** Provider and contract for read-only services (the open data API and the feed): no key needed. */
function readOnly() {
    const d = deployment()
    const provider = new SteadyProvider(d.rpc, d.chainId, { staticNetwork: true })
    return { d, provider, naungan: new ethers.Contract(d.naungan, abi("Naungan"), provider) }
}

/**
 * Every event of `contract` since `fromBlock`, oldest first, each with its block's unix time. History comes
 * from the indexer (retried, it rate-limits bursts), the newest 200 blocks from the RPC; without an
 * indexer, or if it keeps failing, everything from the RPC in 200-block windows.
 */
async function allEvents(contract, fromBlock) {
    const provider = contract.runner.provider
    const head = await provider.getBlockNumber()
    const out = []
    if (head - fromBlock > 200) {
        const h = await history(contract, fromBlock, head)
        if (h) out.push(...h.events), (fromBlock = h.upTo + 1)
    }
    for (let b = fromBlock; b <= head; b += 200) out.push(...(await contract.queryFilter("*", b, Math.min(b + 199, head))).filter((e) => e.fragment))
    const times = new Map() // RPC logs carry no time: one block read per distinct block
    for (const e of out) if (e.timestamp == null && !times.has(e.blockNumber)) times.set(e.blockNumber, (await provider.getBlock(e.blockNumber)).timestamp)
    return out.map((e) => ({ name: e.fragment.name, args: e.args, blockNumber: e.blockNumber, index: e.index, transactionHash: e.transactionHash, timestamp: e.timestamp ?? times.get(e.blockNumber) }))
}

/** Program metadata (hazard location, return period, lead time) as written on-chain at creation. */
async function programMeta(naungan, programId) {
    const raw = await naungan.metadata(programId)
    if (!raw) throw new Error(`Program ${programId} not found`)
    return JSON.parse(raw)
}

// Reverts can come from Naungan or from Semaphore underneath it (e.g. an unknown Merkle root).
let errors
/** Human-readable name of a contract revert ("AlreadyTriggered"), else the RPC's own message. */
function explain(e) {
    errors ??= new ethers.Interface([...abi("Naungan"), ...abi("Semaphore", "@semaphore-protocol/contracts")].filter((x) => x.type === "error"))
    const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data
    try {
        const name = data && errors.parseError(data)?.name
        if (name) return name
    } catch {}
    const msg = e?.shortMessage ?? e?.message ?? String(e)
    // A revert without data reaches us as a bare "Error"; say so, with the code, instead of nothing.
    return /^error$/i.test(msg.trim()) ? `transaction reverted without a reason (${e?.code ?? "unknown"}); often a public RPC node lagging behind, retry` : msg
}

module.exports = { SteadyProvider, ROOT, deployment, abi, connect, readOnly, allEvents, logs, indexed, wideLogs, topicsMatch, programMeta, explain }

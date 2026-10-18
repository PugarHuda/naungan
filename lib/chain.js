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

async function connect() {
    const d = deployment()
    const provider = new ethers.JsonRpcProvider(d.rpc, d.chainId, { staticNetwork: true })
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
            if (p) out.push({ args: p.args, fragment: p.fragment, blockNumber: Number(l.blockNumber), index: Number(l.logIndex), transactionHash: l.transactionHash })
        }
        if (rows.length < 1000) return out
        b = Number(rows.at(-1).blockNumber) // the boundary block is read again; `seen` drops the repeats
    }
}

/**
 * Logs matching `filter`. Public RPCs (Base Sepolia included) cap eth_getLogs at 200 blocks, so a scan
 * from the deploy block grows by ~216 requests a day. With an indexer in deployment.json, history comes
 * from it and only the newest 200 blocks (indexer lag margin) from the RPC; without one, or if it fails,
 * the RPC is read in 200-block windows.
 */
async function logs(contract, filter, fromBlock, toBlock) {
    toBlock ??= await contract.runner.provider.getBlockNumber()
    const out = []
    const indexer = deployment().indexer
    if (indexer && toBlock - fromBlock > 200) {
        try {
            const topic = (await filter.getTopicFilter())[0]
            const upTo = toBlock - 200
            out.push(...(await indexed(indexer, contract, fromBlock, upTo)).filter((e) => e.fragment.topicHash === topic))
            fromBlock = upTo + 1
        } catch (e) {
            console.warn(`${e.message}; reading the RPC instead`)
            out.length = 0
        }
    }
    for (let b = fromBlock; b <= toBlock; b += 200) out.push(...(await contract.queryFilter(filter, b, Math.min(b + 199, toBlock))))
    return out
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

module.exports = { ROOT, deployment, abi, connect, logs, indexed, programMeta, explain }

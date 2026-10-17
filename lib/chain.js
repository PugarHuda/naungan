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

/** eth_getLogs in 200-block windows: public RPCs (Base Sepolia included) reject wider ranges. */
async function logs(contract, filter, fromBlock, toBlock) {
    toBlock ??= await contract.runner.provider.getBlockNumber()
    const out = []
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
    return e?.shortMessage ?? e?.message ?? String(e)
}

module.exports = { ROOT, deployment, abi, connect, logs, programMeta, explain }

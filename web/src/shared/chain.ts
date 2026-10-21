// What every page reads from the chain: the deployment (web/deployment.json, written by scripts/deploy.js
// and bundled at build time), a provider, the contract's public surface and the program list.
import { Contract, JsonRpcProvider, type ContractRunner, type JsonRpcPayload, type JsonRpcResult } from "ethers"
import raw from "../../deployment.json"

export type Deployment = {
    network: string
    chainId: number
    rpc: string
    explorer?: string
    indexer?: string
    eas?: { address: string; registry: string; graphql: string; explorer: string }
    naungan: string
    usdc: string
    usdcIsCircle?: boolean
    semaphore: string
    relayer?: string
    fromBlock?: number
}
export const deployment: Deployment = raw

/** Program metadata as written on-chain at creation (scripts/coordinator.js create). */
export type ProgramMeta = {
    name?: string
    hazard?: "flood" | "heat"
    source?: string
    lat?: number
    lon?: number
    country?: string
    returnPeriod?: number
    leadDays?: number
    unit?: string
    pipelines?: Record<string, "glofas" | "rain" | "heat">
    rain?: { returnPeriod: number; cells: [number, number][] }
    heat?: { tmax: number; tmin?: number; days: number; cells: [number, number][] }
}

/** Naungan.programs(id), as ethers returns the struct. */
export type Program = {
    coordinator: string
    quorum: bigint
    groupId: bigint
    amountPerHousehold: bigint
    triggerThreshold: bigint
    claimWindow: bigint
    claimDeadline: bigint
    lastIndex: bigint
    enrolled: bigint
    funded: bigint
    claims: bigint
    seasonEnd: bigint
}

export const PROGRAMS_FN =
    "function programs(uint256) view returns (address coordinator, uint256 quorum, uint256 groupId, uint256 amountPerHousehold, uint256 triggerThreshold, uint256 claimWindow, uint256 claimDeadline, uint256 lastIndex, uint256 enrolled, uint256 funded, uint256 claims, uint256 seasonEnd)"

export const NAUNGAN_ABI = [
    "function programCount() view returns (uint256)",
    "function metadata(uint256) view returns (string)",
    PROGRAMS_FN,
    "function oracles(uint256) view returns (address[])",
    "function reports(uint256, address) view returns (uint128 value, uint64 ts)",
    "function members(uint256) view returns (uint256[])",
    "function nullifierUsed(uint256, uint256) view returns (bool)",
    "function token() view returns (address)",
    "function contributed(uint256, address) view returns (uint256)",
    "function fund(uint256 programId, uint256 amount)",
    "function refund(uint256 programId)",
    "event AgencyAdded(uint256 indexed programId, address agency)",
    "event AgencyRemoved(uint256 indexed programId, address agency)",
    "event Enrolled(uint256 indexed programId, address indexed agency, uint256 households)",
    "event Funded(uint256 indexed programId, address indexed donor, uint256 amount)",
    "event IndexReported(uint256 indexed programId, address oracle, uint256 value, uint256 agreeing, bool triggered, string evidence)",
    "event Claimed(uint256 indexed programId, uint256 nullifier, address payout)",
    "event Refunded(uint256 indexed programId, address indexed donor, uint256 amount)"
]

export const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function name() view returns (string)",
    "function version() view returns (string)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
]

// A load-balanced public RPC (sepolia.base.org) now and then answers a contract read with empty data or a data-less error, which
// ethers reports as "missing revert data" though nothing reverted. Our reads always return data, so ask again,
// twice at most. Batches that send a transaction are never repeated. lib/chain.js has the same.
export class SteadyProvider extends JsonRpcProvider {
    async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
        const list = [payload].flat()
        for (let i = 0; ; i++) {
            const out = await super._send(payload)
            // Empty data, or an error with no revert data (a real revert of ours carries data): the node, not the contract.
            const empty = out.some((r) => (r.result === "0x" || ("error" in r && !(r as { error?: { data?: unknown } }).error?.data)) && list.find((p) => p.id === r.id)?.method === "eth_call")
            if (!empty || i >= 2 || list.some((p) => p.method === "eth_sendRawTransaction")) return out
            await new Promise((r) => setTimeout(r, 300 * (i + 1)))
        }
    }
}

/** staticNetwork: one chain id request less per page, and no retry storm when the RPC is down. */
export const provider = (d: Deployment = deployment) => new SteadyProvider(d.rpc, d.chainId, { staticNetwork: true })
export const naungan = (runner: ContractRunner = provider(), d: Deployment = deployment) => new Contract(d.naungan, NAUNGAN_ABI, runner)

/** Metadata is free text on-chain: anything that does not parse reads as an unnamed program. */
export function parseMeta(text: string): ProgramMeta {
    try {
        const m = JSON.parse(text)
        return m && typeof m === "object" ? m : {}
    } catch {
        return {}
    }
}

/** Every program with its metadata; program ids start at 1. */
export async function readPrograms(c: Contract = naungan()): Promise<{ id: number; p: Program; meta: ProgramMeta }[]> {
    const n = Number(await c.programCount())
    const ids = Array.from({ length: n }, (_, i) => i + 1)
    const [ps, metas] = await Promise.all([Promise.all(ids.map((i) => c.programs(i))), Promise.all(ids.map((i) => c.metadata(i).then(parseMeta)))])
    return ids.map((id, i) => ({ id, p: ps[i] as Program, meta: metas[i] }))
}

/** Claims are over: the window after a trigger has closed, or the season ended untriggered. Mirrors Naungan.closed(). */
export const isOver = (p: Program, now = Date.now() / 1000) => (p.claimDeadline > 0n ? now > Number(p.claimDeadline) : now > Number(p.seasonEnd))
/** USDC (token units) the pool still lacks to pay every enrolled household not yet paid; 0n once over. Same rule as api/programs.js. */
export function shortfall(p: Program, now = Date.now() / 1000) {
    const owed = (p.enrolled - p.claims) * p.amountPerHousehold, left = p.funded - p.claims * p.amountPerHousehold
    return !isOver(p, now) && owed > left ? owed - left : 0n
}
export const isHeat = (m: ProgramMeta) => m.hazard === "heat"
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

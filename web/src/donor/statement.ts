// A donor's statement: every gift and refund of one address, read from the chain, and what each program did with
// that money. Pools are shared, so a gift is followed pro rata, exactly as the contract's refund() splits a pool:
// a donor who gave a quarter of a pool paid for a quarter of its claims.
import { id as topic, zeroPadValue, type Contract } from "ethers"
import { deployment as d } from "../shared/chain"

export type Move = { programId: number; amount: bigint; tx: string; block: number; index: number; at: number }
export type Pool = { amountPerHousehold: bigint; funded: bigint; claims: bigint; over: boolean }
export type Line = {
    programId: number
    gifts: Move[]
    gave: bigint
    /** The donor's share of what the pool paid to households. */
    paid: bigint
    /** Households that share paid for (a fraction when several donors share a pool). */
    households: number
    refunded: bigint
    /** Still in the pool, waiting for claims (state "pool"), or the donor's to take back (state "refundable"). */
    left: bigint
    state: "pool" | "refundable" | "refunded"
}

export function statement(gifts: Move[], refunds: Move[], pools: Map<number, Pool>): Line[] {
    const ids = [...new Set(gifts.map((g) => g.programId))].sort((a, b) => a - b)
    return ids.map((programId) => {
        const p = pools.get(programId)
        if (!p || p.funded === 0n) throw new Error(`no pool state for program #${programId}`)
        const mine = gifts.filter((g) => g.programId === programId).sort((a, b) => a.block - b.block || a.index - b.index)
        const gave = mine.reduce((s, g) => s + g.amount, 0n)
        const refunded = refunds.filter((r) => r.programId === programId).reduce((s, r) => s + r.amount, 0n)
        const paid = (gave * p.claims * p.amountPerHousehold) / p.funded
        const households = Number((gave * p.claims * 1000n) / p.funded) / 1000
        // refund() pays gave × (funded − claims × amount) / funded, floored: the same figure, so the page never promises more.
        const left = refunded > 0n ? 0n : p.over ? (gave * (p.funded - p.claims * p.amountPerHousehold)) / p.funded : gave - paid
        return { programId, gifts: mine, gave, paid, households, refunded, left, state: refunded > 0n ? "refunded" : p.over ? "refundable" : "pool" }
    })
}

const FUNDED = topic("Funded(uint256,address,uint256)")
const REFUNDED = topic("Refunded(uint256,address,uint256)")

/**
 * This donor's Funded and Refunded events: one eth_getLogs filtered on the indexed donor topic from a public RPC that
 * serves the whole range (deployment.json `logRpcs`), so nothing passes through our servers; this site's open data
 * when none answers.
 */
export async function movesOf(c: Contract, donor: string): Promise<{ gifts: Move[]; refunds: Move[]; source: string }> {
    const split = (rows: (Move & { name: string })[], source: string) => ({ gifts: rows.filter((r) => r.name === "Funded"), refunds: rows.filter((r) => r.name === "Refunded"), source })
    for (const url of d.logRpcs ?? []) {
        try {
            const res = await fetch(url, {
                method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15e3),
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: c.target, fromBlock: "0x" + (d.fromBlock ?? 0).toString(16), toBlock: "latest", topics: [[FUNDED, REFUNDED], null, zeroPadValue(donor, 32)] }] })
            })
            const r: { result?: { topics: string[]; data: string; blockNumber: string; logIndex: string; transactionHash: string; blockTimestamp?: string }[] } = await res.json()
            if (!r.result || r.result.some((l) => !l.blockTimestamp)) throw new Error("no result with block times")
            return split(r.result.map((l) => {
                const p = c.interface.parseLog(l)!
                return { name: p.name, programId: Number(p.args.programId), amount: p.args.amount as bigint, tx: l.transactionHash, block: Number(l.blockNumber), index: Number(l.logIndex), at: Number(l.blockTimestamp) }
            }), new URL(url).host)
        } catch (e) {
            console.warn(`${url}: ${(e as Error).message}; trying the next source`)
        }
    }
    const res = await fetch(`${d.relayer ?? location.origin}/api/programs?format=events`, { signal: AbortSignal.timeout(20e3) })
    if (!res.ok) throw new Error(`open data answered ${res.status}`)
    const j: { events: { name: string; args: string[]; blockNumber: number; index: number; transactionHash: string; timestamp: number }[] } = await res.json()
    const rows = j.events
        .filter((e) => (e.name === "Funded" || e.name === "Refunded") && e.args[1].toLowerCase() === donor.toLowerCase())
        .map((e) => ({ name: e.name, programId: Number(e.args[0]), amount: BigInt(e.args[2]), tx: e.transactionHash, block: e.blockNumber, index: e.index, at: e.timestamp }))
    return split(rows, "open data")
}

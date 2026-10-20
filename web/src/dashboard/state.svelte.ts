// The dashboard's one source of truth: the selected program, its contract state and its event history,
// refreshed from the chain every 2 seconds. Panels only derive from it.
import type { Contract } from "ethers"
import { deployment as d, naungan, parseMeta, type Program, type ProgramMeta } from "../shared/chain"
import type { Ev } from "./format"

export const c: Contract = naungan()
export type Report = { value: bigint; ts: bigint }
export type Check = { cls: string; text: string; retry?: boolean }

class Dash {
    count = $state(0n)
    metas = $state<Record<string, ProgramMeta>>({})
    pid = $state<bigint>()
    /** Contract state of `pid` (raw: ethers Results are not plain objects and must not be proxied). */
    p = $state.raw<Program | null>(null)
    os = $state.raw<string[]>([])
    reps = $state.raw<Report[]>([])
    /** This program's events, oldest first; null until the history has been read once. */
    current = $state.raw<Ev[] | null>(null)
    now = $state(Date.now() / 1000)
    /** Re-check results by report transaction: kept across refreshes until a newer report lands. */
    checks = $state<Record<string, Check>>({})
    /** Bumped to reload the EAS auditor list (after the visitor signs one). */
    auditorsRev = $state(0)
    error = $state("")
    get meta(): ProgramMeta {
        return (this.pid !== undefined && this.metas[String(this.pid)]) || {}
    }
}
export const dash = new Dash()

export function select(id: bigint) {
    dash.pid = id
    dash.p = null
    dash.current = null
    const m = dash.metas[String(id)] ?? {}
    document.title = `${m.name ?? "Program " + id} | Naungan`
    history.replaceState(null, "", `?program=${id}`)
}

async function programs() {
    const n: bigint = await c.programCount()
    if (n === dash.count) return
    const metas = { ...dash.metas }
    for (let i = dash.count + 1n; i <= n; i++) {
        const m = parseMeta(await c.metadata(i))
        metas[String(i)] = m.name ? m : { ...m, name: `Program ${i}` }
    }
    dash.metas = metas
    dash.count = n
    const want = BigInt(new URLSearchParams(location.search).get("program") || n)
    if (dash.pid === undefined) select(want >= 1n && want <= n ? want : n)
}

/**
 * Event history from a Blockscout indexer (one request per 1000 events, no block-range cap), parsed into
 * the same {args, fragment, blockNumber, index, transactionHash} shape as ethers' EventLog.
 */
async function indexed(indexer: string, fromBlock: number, toBlock: number) {
    const out: Ev[] = [], seen = new Set<string>()
    for (let b = fromBlock, tries = 0; ; ) {
        const res = await fetch(`${indexer}?module=logs&action=getLogs&fromBlock=${b}&toBlock=${toBlock}&address=${c.target}`)
        // The free indexer answers 429 under bursts: wait and ask again before falling back to slow RPC windows.
        if (res.status === 429 && tries++ < 3) {
            await new Promise((ok) => setTimeout(ok, 1500 * tries))
            continue
        }
        const r = await res.json()
        if (r.status !== "1" && !/no records/i.test(r.message ?? "")) throw new Error(`indexer: ${r.message}`)
        const rows: { transactionHash: string; logIndex: string; topics: (string | null)[]; data: string; blockNumber: string }[] = Array.isArray(r.result) ? r.result : []
        for (const l of rows) {
            const key = l.transactionHash + l.logIndex
            if (seen.has(key)) continue
            seen.add(key)
            const p = c.interface.parseLog({ topics: l.topics.filter((t): t is string => Boolean(t)), data: l.data })
            if (p) out.push({ args: p.args, fragment: p.fragment, blockNumber: Number(l.blockNumber), index: Number(l.logIndex), transactionHash: l.transactionHash })
        }
        if (rows.length < 1000) return out
        b = Number(rows.at(-1)!.blockNumber) // the boundary block is read again; `seen` drops the repeats
    }
}

// Every program's events, read once and then followed block by block.
const events: Ev[] = [], have = new Set<string>()
let next: number | undefined
const from = d.fromBlock ?? 0

async function tick() {
    await programs()
    if (dash.count === 0n) return
    const id = dash.pid!
    const [p, os] = await Promise.all([c.programs(id), c.oracles(id)])
    const reps: Report[] = await Promise.all(os.map((o: string) => c.reports(id, o)))
    if (id !== dash.pid) return
    dash.now = Date.now() / 1000
    dash.p = p
    dash.os = [...os]
    dash.reps = reps
    // Public RPCs cap eth_getLogs at 200 blocks: history comes from the Blockscout indexer in one request,
    // the newest 200 blocks (its lag margin) and every later tick from the RPC; RPC windows if it is down.
    const head = await c.runner!.provider!.getBlockNumber()
    if (next === undefined && d.indexer && head - from > 200) {
        try {
            for (const e of await indexed(d.indexer, from, head - 200)) have.add(e.transactionHash + e.index), events.push(e)
            next = head - 199
        } catch (e) {
            console.warn((e as Error).message, "; reading the RPC instead")
            events.length = 0
            have.clear()
        }
    }
    // Each tick re-reads the last 10 blocks: a load-balanced RPC can report a head that the node serving
    // eth_getLogs has not reached yet, and a plain cursor would skip those events forever. `have` dedups.
    // Without the indexer that is hundreds of windows: read 5 at a time instead of one after another.
    for (next = Math.max(from, (next ?? from) - 10); next <= head; ) {
        const spans: [number, number][] = []
        for (let b = next; b <= head && spans.length < 5; b += 200) spans.push([b, Math.min(b + 199, head)])
        for (const got of await paced(() => Promise.all(spans.map(([f, t]) => c.queryFilter("*", f, t)))))
            for (const e of got as unknown as Ev[]) if (!have.has(e.transactionHash + e.index)) have.add(e.transactionHash + e.index), events.push(e)
        next = spans.at(-1)![1] + 1
        if (next <= head) await sleep(250) // 5 windows per 250 ms stays under the public RPC's 25 requests/s
    }
    if (id !== dash.pid) return
    const mine = events.filter((e) => e.fragment && e.args?.programId === id).sort((x, y) => x.blockNumber - y.blockNumber || x.index - y.index)
    // Only hand panels a new array when something changed, so the ledger and oracles do not re-render every 2 s.
    const cur = dash.current
    if (!cur || cur.length !== mine.length || cur.at(-1) !== mine.at(-1)) dash.current = mine
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Base Sepolia's public RPC answers -32007 ("25/second request limit") or 429 under bursts: back off and retry. */
const limited = (e: unknown) => /-32007|request limit|429|Too Many/i.test(JSON.stringify((e as { error?: unknown })?.error ?? "") + String((e as Error)?.message ?? e))
async function paced<T>(run: () => Promise<T>): Promise<T> {
    for (let wait = 1000; ; wait *= 2) {
        try {
            return await run()
        } catch (e) {
            if (!limited(e) || wait > 8000) throw e
            await sleep(wait)
        }
    }
}

export async function start() {
    try {
        await tick()
    } catch (e) {
        dash.error = "The chain is unreachable right now"
        console.error(e)
    }
    // ponytail: chained timeout so a slow chunked scan never overlaps the next tick
    const loop = () => tick().catch(console.error).finally(() => setTimeout(loop, 2000))
    setTimeout(loop, 2000)
}

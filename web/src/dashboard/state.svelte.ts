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
        const res = await fetch(`${indexer}?module=logs&action=getLogs&fromBlock=${b}&toBlock=${toBlock}&address=${c.target}`, { signal: AbortSignal.timeout(15e3) })
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

/**
 * The same history from this site's open-data API (api/programs.js, cached at the edge and kept while the chain or
 * indexer fails), for when the free indexer is down. Each event is re-encoded and parsed with the contract's own ABI,
 * so the panels get exactly the objects a chain read gives. Returns the block it is complete up to.
 */
async function fromApi(): Promise<{ events: Ev[]; toBlock: number }> {
    const res = await fetch(`${d.relayer ?? location.origin}/api/programs?format=events`, { signal: AbortSignal.timeout(20e3) })
    if (!res.ok) throw new Error(`open-data API answered ${res.status}`)
    const j: { contract: string; toBlock: number; events: { name: string; args: unknown[]; blockNumber: number; index: number; transactionHash: string }[] } = await res.json()
    if (j.contract.toLowerCase() !== String(c.target).toLowerCase()) throw new Error("open-data API serves another contract")
    // Events the page's ABI does not list (ProgramCreated…) are skipped, as parseLog skips them from the indexer.
    const events = j.events.flatMap((e) => {
        if (!c.interface.getEvent(e.name)) return []
        const { topics, data } = c.interface.encodeEventLog(e.name, e.args as never[])
        const p = c.interface.parseLog({ topics, data })!
        return [{ args: p.args, fragment: p.fragment, blockNumber: e.blockNumber, index: e.index, transactionHash: e.transactionHash }]
    })
    return { events, toBlock: j.toBlock }
}

/**
 * eth_getLogs over wide ranges from public RPCs that allow it (deployment.json `logRpcs`, as lib/chain.js wideLogs
 * reads them for the services). The span halves when a node refuses it.
 */
async function wideLogs(url: string, fromBlock: number, toBlock: number): Promise<Ev[]> {
    const out: Ev[] = []
    for (let b = fromBlock, span = 100_000; b <= toBlock; ) {
        const to = Math.min(b + span - 1, toBlock)
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15e3), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: c.target, fromBlock: "0x" + b.toString(16), toBlock: "0x" + to.toString(16) }] }) })
        const r: { error?: { message: string }; result?: { topics: string[]; data: string; blockNumber: string; logIndex: string; transactionHash: string }[] } = await res.json()
        if (r.error || !r.result) {
            if (span <= 1000) throw new Error(r.error?.message ?? "no result")
            span = Math.floor(span / 2)
            continue
        }
        for (const l of r.result) {
            const p = c.interface.parseLog({ topics: l.topics, data: l.data })
            if (p) out.push({ args: p.args, fragment: p.fragment, blockNumber: Number(l.blockNumber), index: Number(l.logIndex), transactionHash: l.transactionHash })
        }
        b = to + 1
    }
    return out
}

/** Where the full history can come from, fastest first: wide-range RPCs, the Blockscout indexer, this site's open data. */
const sources = (head: number): [string, () => Promise<{ events: Ev[]; upTo: number }>][] => [
    ...(d.logRpcs ?? []).map((u): [string, () => Promise<{ events: Ev[]; upTo: number }>] => [new URL(u).host, async () => ({ events: await wideLogs(u, from, head), upTo: head })]),
    ...(d.indexer ? [["indexer", async () => ({ events: await indexed(d.indexer!, from, head - 200), upTo: head - 200 })] as [string, () => Promise<{ events: Ev[]; upTo: number }>]] : []),
    ["open-data API", async () => { const a = await fromApi(); return { events: a.events, upTo: a.toBlock } }]
]

// Every program's events, read once and then followed block by block.
const events: Ev[] = [], have = new Set<string>()
/** Every program's events read so far (the running-costs panel samples real transactions from them). */
export const allEvents = (): readonly Ev[] => events
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
    // Public RPCs cap eth_getLogs at 200 blocks: the whole history comes from the first source that answers
    // (sources() below), every later tick from the RPC; RPC windows if none does.
    const head = await c.runner!.provider!.getBlockNumber()
    if (next === undefined && head - from > 200) {
        for (const [name, read] of sources(head)) {
            try {
                const h = await read()
                for (const e of h.events) have.add(e.transactionHash + e.index), events.push(e)
                next = Math.min(h.upTo, head) + 1 // a cached API copy can be older than the head: the RPC reads the rest
                break
            } catch (e) {
                console.warn(`${name}: ${(e as Error).message}; trying the next history source`)
                events.length = 0
                have.clear()
            }
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

<script lang="ts">
    // What households say: their anonymous ratings, each a Semaphore proof of membership in this program's group that
    // Semaphore's own contract verified on-chain (lib/feedback.mjs). Read from the chain in this browser: the
    // ProofValidated logs filtered on their indexed group and feedback scope; the open data when no wide RPC answers.
    import { Interface, toBeHex } from "ethers"
    import { PROOF_VALIDATED, TOPICS, decode, feedbackScope, summarise } from "../../../lib/feedback.mjs"
    import { deployment as d } from "../shared/chain"
    import { dash } from "./state.svelte"

    const LABEL: Record<string, string> = { none: "Nothing wrong", late: "Came too late", tooLittle: "Not enough", cashOut: "Hard to cash out", leftOut: "Someone was left out" }
    type Item = { rating: number; topic: number; tx: string; at: number }
    type Read = { items: Item[] | null; summary: ReturnType<typeof summarise>; source: string }
    const iface = new Interface([PROOF_VALIDATED])

    async function fromChain(url: string, groupId: bigint, scope: bigint): Promise<Item[]> {
        const topics = [iface.getEvent("ProofValidated")!.topicHash, toBeHex(groupId, 32), null, toBeHex(scope, 32)]
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15e3), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: d.semaphore, topics, fromBlock: "0x" + (d.fromBlock ?? 0).toString(16), toBlock: "latest" }] }) })
        const r: { error?: { message: string }; result?: { topics: string[]; data: string; transactionHash: string; blockTimestamp?: string }[] } = await res.json()
        if (r.error || !r.result) throw new Error(r.error?.message ?? "no result")
        return r.result.flatMap((l) => {
            const f = decode(iface.parseLog(l)!.args.message)
            return f ? [{ ...f, tx: l.transactionHash, at: Number(l.blockTimestamp ?? 0) }] : []
        })
    }

    async function read(pid: bigint, groupId: bigint): Promise<Read> {
        const scope = feedbackScope(d.naungan, pid)
        for (const u of d.logRpcs ?? []) {
            try {
                const items = await fromChain(u, groupId, scope)
                return { items, summary: summarise(items.map((i) => BigInt(i.topic * 10 + i.rating))), source: new URL(u).host }
            } catch {} // next source
        }
        const api = await (await fetch("/api/programs", { signal: AbortSignal.timeout(30e3) })).json()
        const summary = api.programs.find((x: { id: number }) => BigInt(x.id) === pid)?.feedback
        if (!summary) throw new Error("no source answered")
        return { items: null, summary, source: "open-data API" }
    }

    let got = $state<Read | null>(null)
    let err = $state("")
    $effect(() => {
        const pid = dash.pid, g = dash.p?.groupId
        if (pid === undefined || g === undefined) return
        got = null
        err = ""
        read(pid, g).then((r) => dash.pid === pid && (got = r)).catch((e: Error) => dash.pid === pid && (err = e.message))
    })
    const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n)
</script>

<article class="panel" aria-labelledby="fbH" id="feedback">
    <h2 id="fbH">What households say</h2>
    <p class="lead-in">Each rating is a zero-knowledge proof that an enrolled household answered, verified by Semaphore on-chain: one per household, no name, not linkable to its payment.</p>
    {#if err}
        <p class="fine" role="status">Ratings are unavailable right now ({err}).</p>
    {:else if !got}
        <p class="fine" role="status">Reading ratings from the chain…</p>
    {:else if !got.summary.count}
        <p class="fine" role="status">No household has rated this program yet. Enrolled households can, from their claim app.</p>
    {:else}
        <div class="big" role="status"><span>{got.summary.mean}</span> <small>of 5 from <span>{got.summary.count}</span> {got.summary.count === 1 ? "household" : "households"}</small></div>
        <ul class="bars" aria-label="Ratings">
            {#each [5, 4, 3, 2, 1] as n (n)}
                <li><span>{n}★</span><i style="width: {(got.summary.ratings[n - 1] / got.summary.count) * 100}%"></i><b>{got.summary.ratings[n - 1]}</b></li>
            {/each}
        </ul>
        <p class="fine">
            {TOPICS.filter((k) => k !== "none" && got!.summary.topics[k]).map((k) => `${LABEL[k]}: ${got!.summary.topics[k]}`).join(" · ") || "No problem reported."}
        </p>
        {#if got.items?.length && d.explorer}
            <details>
                <summary>Each rating on-chain</summary>
                <ul class="fine">
                    {#each got.items.slice(-10).reverse() as it (it.tx)}
                        <li><span aria-label="{it.rating} of 5">{stars(it.rating)}</span> {LABEL[TOPICS[it.topic]]}{it.at ? `, ${new Date(it.at * 1000).toISOString().slice(0, 10)}` : ""} · <a href="{d.explorer}/tx/{it.tx}" target="_blank" rel="noopener">proof</a></li>
                    {/each}
                </ul>
            </details>
        {/if}
    {/if}
    <p class="fine">Read from {got?.source ?? "the chain"}.</p>
</article>

<style>
    .bars { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 4px; }
    .bars li { display: grid; grid-template-columns: 2.5em 1fr 2em; align-items: center; gap: 8px; font-size: 14px; }
    .bars i { display: block; height: 8px; border-radius: 4px; background: var(--accent); min-width: 2px; }
    .bars b { text-align: right; }
</style>

<script lang="ts">
    import { deployment as d } from "../shared/chain"
    import { dash } from "./state.svelte"
    import { describe, txUrl } from "./format"

    const rows = $derived((dash.current ?? []).slice().reverse())

    // Audit export: every event of the selected program exactly as on-chain, re-checkable via the tx hash.
    const auditRows = () =>
        (dash.current ?? []).map((e) => ({
            block: e.blockNumber, tx: e.transactionHash, event: e.fragment.name,
            ...Object.fromEntries(e.fragment.inputs.map((inp, i) => [inp.name, String(e.args[i])]))
        }))
    function download(name: string, type: string, text: string) {
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name })
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    function csv() {
        const list: Record<string, unknown>[] = auditRows()
        const cols = [...new Set(list.flatMap(Object.keys))]
        // Quote every cell; prefix formula-looking cells so spreadsheets never execute chain data (CSV injection).
        const cell = (v: unknown) => `"${String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`
        download(`naungan-program-${dash.pid}-audit.csv`, "text/csv", [cols.map(cell).join(","), ...list.map((r) => cols.map((k) => cell(r[k])).join(","))].join("\r\n"))
    }
    function json() {
        download(`naungan-program-${dash.pid}-audit.json`, "application/json", JSON.stringify({ network: d.network, chainId: d.chainId, contract: d.naungan, program: String(dash.pid), metadata: dash.meta, events: auditRows() }, null, 2))
    }
</script>

<article class="panel" aria-labelledby="ledgerH">
    <div class="ledgerhead">
        <h2 id="ledgerH">Ledger</h2>
        <div><button class="btn ghost" type="button" onclick={csv}>Download CSV</button><button class="btn ghost" type="button" onclick={json}>JSON</button></div>
    </div>
    <p class="lead-in" style="margin:0">Every event of this program, newest first, each linked to its transaction.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="feed" tabindex="0" role="log" aria-label="Ledger of program events">
        {#if !dash.current}
            <div class="empty">Reading the history from the indexer…</div>
        {:else if !rows.length}
            <div class="empty">No events for this program yet.</div>
        {:else}
            {#each rows as e (e.transactionHash + e.index)}
                {@const [title, meta] = describe(e, dash.metas)}
                <div class="row {e.fragment.name} new" class:on={e.args.triggered}>
                    <span class="dot"></span>
                    <div><div class="title">{title}</div><div class="meta">{meta}</div></div>
                    {#if txUrl(e.transactionHash)}
                        <a class="blk" href={txUrl(e.transactionHash)} target="_blank" rel="noopener" aria-label="Transaction in block {e.blockNumber}">#{e.blockNumber}</a>
                    {:else}
                        <span class="blk">#{e.blockNumber}</span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</article>

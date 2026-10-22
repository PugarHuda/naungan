<script lang="ts">
    // In plain words: the explanation a household of this program reads in its claim app (api/explain.js), in any of
    // the claim app's languages, so a donor or agency sees exactly what families are told and can check it against
    // the facts beside it. The same CDN-cached answer the claim app gets: choosing a language here costs no extra call.
    import { deployment as d } from "../shared/chain"
    import { NATIVE } from "../claim/i18n"
    import { dash } from "./state.svelte"

    type Answer = { text: string | null; refused?: string; model?: string; facts?: Record<string, string | number> }
    let lang = $state("en")
    let got = $state<Answer | null>(null)
    let err = $state("")
    $effect(() => {
        const pid = dash.pid, l = lang
        if (pid === undefined) return
        got = null
        err = ""
        fetch(`${d.relayer ?? location.origin}/api/explain?program=${pid}&lang=${l}`, { signal: AbortSignal.timeout(60e3) })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`answered ${r.status}`))))
            .then((a: Answer) => dash.pid === pid && lang === l && (got = a))
            .catch((e: Error) => dash.pid === pid && (err = e.message))
    })
</script>

<article class="panel" aria-labelledby="plainH" id="plain">
    <div class="ledgerhead">
        <h2 id="plainH">In plain words</h2>
        <select aria-label="Language of the explanation" bind:value={lang}>
            {#each Object.entries(NATIVE) as [code, name] (code)}<option value={code}>{name}</option>{/each}
        </select>
    </div>
    <p class="lead-in">What a household of this program reads in its claim app: written by Claude from the program's public on-chain facts, and shown only when every number in it is in those facts and it is in the language asked for.</p>
    {#if err}
        <p class="fine" role="status">The explanation is unavailable right now ({err}).</p>
    {:else if !got}
        <p class="fine" role="status">Reading the explanation…</p>
    {:else if got.text}
        <p class="plain" lang={lang} role="status">{got.text}</p>
        <p class="fine">{got.model} · checked: every figure appears in the facts below, no link, address or contact.</p>
        {#if got.facts}
            <details>
                <summary>The facts it was given</summary>
                <dl class="facts">{#each Object.entries(got.facts) as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
            </details>
        {/if}
    {:else}
        <p class="fine" role="status">No explanation is shown ({got.refused}). Households then see only the program card.</p>
    {/if}
</article>

<style>
    .plain { font-size: 17px; line-height: 1.55; margin: 10px 0 }
    select { font: inherit; padding: 6px 8px; border-radius: 8px }
    .facts { font-size: 13px; display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 8px 0 0 }
    .facts dt { font-weight: 600 }
    .facts dd { margin: 0; overflow-wrap: anywhere }
</style>

<script lang="ts">
    import { dash } from "./state.svelte"
    import { words } from "./format"
    import { fresh, level } from "./trigger"
    import OracleRow from "./OracleRow.svelte"

    const p = $derived(dash.p)
    const w = $derived(words(dash.meta))
    const on = $derived(!!p && p.claimDeadline > 0n)
    const shown = $derived(p ? (on ? Number(p.lastIndex) : level(p, dash.reps, dash.now)) : null)
    const agreeing = $derived(p ? dash.reps.filter((r) => fresh(r, dash.now) && r.value >= p.triggerThreshold).length : 0)
    const n = $derived(dash.os.length)
    const s = $derived(n === 1 ? "" : "s")
    // The re-check needs the evidence strings, which only the event history has.
    const reports = $derived((dash.current ?? []).filter((e) => e.fragment.name === "IndexReported"))
    const pipes = $derived(Object.fromEntries(Object.entries(dash.meta.pipelines ?? {}).map(([k, v]) => [k.toLowerCase(), v])))
</script>

<section class="screen" class:on aria-labelledby="triggerH">
    <h2 id="triggerH">{on ? `${w.Noun} probability at the trigger` : `${w.Noun} probability now`}</h2>
    <div class="meter"><b><span>{shown ?? "–"}</span>%</b><span>of <span>{p ? String(p.triggerThreshold) : "–"}</span>% needed</span></div>
    <div class="track" aria-hidden="true"><i style:width="{p && shown != null ? Math.min(100, (shown / Number(p.triggerThreshold)) * 100) : 0}%"></i></div>
    <p class="quorum">
        {!p ? "Waiting for the oracles…" : on ? `Triggered: ${p.quorum} of ${n} oracle${s} agreed.` : `${agreeing} of ${n} oracle${s} at the trigger. Claims open when ${p.quorum} agree.`}
    </p>
    {#if p}
        {#each dash.os as o, i (o)}
            {#if dash.reps[i]}
                <OracleRow oracle={o} report={dash.reps[i]} last={reports.findLast((e) => e.args.oracle === o)} kind={pipes[o.toLowerCase()] ?? (dash.meta.hazard === "heat" ? "heat" : dash.meta.source ? "glofas" : "")} threshold={p.triggerThreshold} triggered={on} />
            {/if}
        {/each}
    {/if}
</section>

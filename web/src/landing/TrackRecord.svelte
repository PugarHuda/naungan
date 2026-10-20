<script lang="ts">
    // The featured program's exact trigger replayed over the reanalysis. ~30 years of data: fetched only
    // when the section scrolls near (and cached for the day by lib/hazard.mjs).
    import { trackRecord } from "../shared/verify.mjs"
    import { fmt, years, type FloodMeta, type TrackRecord } from "./record"

    let { meta }: { meta: (FloodMeta & { name: string }) | undefined } = $props()

    let section: HTMLElement
    let near = $state(false)
    let r = $state<TrackRecord | null>(null)
    let error = $state("")

    $effect(() => {
        const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) (near = true), io.disconnect() }, { rootMargin: "400px" })
        io.observe(section)
        return () => io.disconnect()
    })
    $effect(() => {
        if (!near || !meta) return
        trackRecord(meta)
            .then((x: TrackRecord) => (r = x))
            .catch((e: Error) => (error = `Could not load the record from Open-Meteo (${e.message}). Reload to try again.`))
    })

    const W = 1000
    const from = $derived(r ? Date.parse(r.flood.from) : 0)
    const to = $derived(r ? Date.parse(r.flood.to) : 1)
    const x = (d: string) => 20 + ((Date.parse(d) - from) / (to - from)) * (W - 40)
    const ticks = $derived.by(() => {
        if (!r) return []
        const out: number[] = []
        for (let y = new Date(from).getUTCFullYear() + 1; y <= new Date(to).getUTCFullYear(); y++) if (y % 5 === 0) out.push(y)
        return out
    })
    const quorum = $derived(Boolean(r?.rain))
</script>

<section class="band" id="record" aria-labelledby="recordH" bind:this={section}>
    <div class="wrap">
        <div class="eyebrow">Track record</div>
        <h2 class="big" id="recordH">Would it have paid when it mattered?</h2>
        <p class="intro">
            {#if r && meta}“{meta.name}”: its exact trigger, replayed over every day of the public reanalysis ({fmt(r.flood.from)} to {fmt(r.flood.to)}), in your browser with the oracles’ own code.{:else}The live program’s exact trigger, replayed over every day of the public reanalysis, in your browser with the oracles’ own code.{/if}
        </p>
        <div class="record-stats">
            <div class="panel rstat"><b>{r ? r.paid.length : "–"}</b><span>{r ? `times in ${years(r)} years the ${quorum ? "2-of-2 quorum" : "trigger"} would have paid` : "times the 2-of-2 quorum would have paid"}</span></div>
            <div class="panel rstat"><b>{r && quorum ? r.rainOnly.length : "–"}</b><span>rain-only alarms the quorum held back</span></div>
            <div class="panel rstat"><b>{r ? (r.paid.length ? fmt(r.paid.at(-1)!.peakDate) : "never") : "–"}</b><span>most recent payout date</span></div>
        </div>
        <div class="panel timeline">
            <svg id="tl" viewBox="0 0 1000 150" role="img" aria-label="Timeline of trigger episodes">
                {#if r}
                    <line x1="20" x2={W - 20} y1="112" y2="112" stroke="#C9CED3" stroke-width="2" />
                    {#each ticks as y (y)}<text x={x(`${y}-01-01`)} y="138" font-size="16" fill="#5C6268" text-anchor="middle">{y}</text>{/each}
                    {#each r.rainOnly as e}<rect x={x(e.peakDate) - 3} y="82" width="6" height="30" rx="3" fill="#B8BEC4" />{/each}
                    {#each r.paid as e}<rect x={x(e.peakDate) - 4} y="22" width="8" height="90" rx="4" fill="#3DD27B" />{/each}
                {/if}
            </svg>
            <div class="legend"><span><i style="background:var(--green)"></i>both oracles: pays</span><span><i style="background:#B8BEC4"></i>rain only: held back</span></div>
            <ul class="paid-list">
                {#each r ? r.paid.slice().reverse() : [] as e}<li><b>{fmt(e.peakDate)}</b>river peak {Math.round(e.peak)} m³/s</li>{/each}
            </ul>
            <p class="caveat" id="recordMsg">
                {#if error}{error}{:else if r && meta}GloFAS v4 river discharge above the 1-in-{meta.returnPeriod}-year flood ({Math.round(r.flood.threshold)} m³/s){#if quorum && r.rain && meta.rain}, and ERA5 catchment rainfall above its 1-in-{meta.rain.returnPeriod}-year {meta.leadDays}-day total ({Math.round(r.rain.threshold)} mm) within {meta.leadDays} days of it{/if}. This is what a perfect forecast would have triggered: it shows how often the program would pay, not how skilful forecasts are.{:else}Loading 30 years of river discharge and rainfall from Open-Meteo…{/if}
            </p>
        </div>
    </div>
</section>

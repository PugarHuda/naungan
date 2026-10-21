<script lang="ts">
    // Track record: when this program's trigger would have fired over the reanalysis (lib/hazard.mjs via verify.mjs).
    import { dash } from "./state.svelte"
    import { day } from "./format"
    import { record, loadRecord } from "./record.svelte"

    let early = $state<string | null>(null)
    $effect(() => {
        void dash.pid
        early = null
    })
    const heat = $derived(dash.meta.hazard === "heat")
    const wind = $derived(dash.meta.hazard === "wind")
    const mine = $derived(record.pid === dash.pid)
    const msg = $derived.by(() => {
        if (early) return { cls: "verdict", text: early }
        if (!mine) return null
        if (record.busy) return { cls: "verdict", text: heat ? "Fetching about 40 years of daily maximum temperature from Open-Meteo…" : wind ? "Fetching about 40 years of daily peak wind gusts from Open-Meteo…" : "Fetching about 30 years of river discharge and rainfall from Open-Meteo…" }
        if (record.error) return { cls: "verdict bad", text: `Could not load the record (${record.error}). Try again in a minute.` }
        return null
    })
    const rec = $derived.by(() => {
        const r = mine ? record.r : null, m = dash.meta
        if (!r) return null
        const tail = " This replays a perfect forecast: it shows how often the program pays, not how skilful forecasts are."
        const note = wind
            ? `Pays when ERA5's daily peak gust passes the place's 1-in-${m.wind?.returnPeriod ?? m.returnPeriod}-year gust (${Math.round(r.flood.threshold)} km/h). Reanalysis smooths a cyclone's core, so the level is the place's own record on the same grid, not a storm category.${tail}`
            : heat
            ? `Pays when ERA5 records ${m.heat?.days ?? 2} or more consecutive days above ${r.flood.threshold} °C${m.heat?.tmin == null ? "" : ` with nights above ${m.heat.tmin} °C`}.${tail}`
            : `Pays when the river passes the 1-in-${m.returnPeriod}-year flood (${Math.round(r.flood.threshold)} m³/s)` +
              (r.rain && m.rain ? ` and catchment rain passes its 1-in-${m.rain.returnPeriod}-year ${m.leadDays}-day total (${Math.round(r.rain.threshold)} mm) within ${m.leadDays} days.` : ".") + tail
        return { r, heat, wind, note }
    })
    const busy = $derived(mine && record.busy)

    async function replay() {
        early = null
        try {
            await loadRecord()
        } catch (e) {
            early = (e as Error).message
        }
    }

    // Timeline: tall green bars where the program pays, short grey ones where only the rain oracle fired.
    const W = 600
    const tl = $derived.by(() => {
        if (!rec) return null
        const { r } = rec, from = Date.parse(r.flood.from), to = Date.parse(r.flood.to)
        const x = (dt: string) => 12 + ((Date.parse(dt) - from) / (to - from)) * (W - 24)
        const years: number[] = []
        for (let yr = new Date(from).getUTCFullYear() + 1; yr <= new Date(to).getUTCFullYear(); yr++) if (yr % 5 === 0) years.push(yr)
        return { x, years, span: Math.round((to - from) / 3.156e10) }
    })
</script>

<article class="panel" aria-labelledby="recordH">
    <h2 id="recordH">Would it have paid before?</h2>
    <p class="lead-in">Replay this program’s exact trigger over every day of the public reanalysis since {heat || wind ? 1984 : 1997}, with the oracles’ own code.</p>
    <button class="btn dark" type="button" hidden={dash.meta.lat == null} disabled={busy} onclick={replay}>Replay {heat || wind ? 40 : 30} years</button>
    <div class="result" role="status">
        {#if msg}<div class={msg.cls}>{msg.text}</div>{/if}
        {#if rec && tl}
            {@const r = rec.r}
            <div class="head"><b>{r.paid.length}</b><span>payouts in {tl.span} years{r.rain ? `, with ${r.rainOnly.length} rain-only alarms held back by the quorum` : ""}</span></div>
            <svg viewBox="0 0 {W} 120" role="img" aria-label="Timeline from {r.flood.from} to {r.flood.to}: {r.paid.length} payouts, {r.rainOnly.length} rain-only alarms">
                <line x1="12" x2={W - 12} y1="92" y2="92" stroke="#C9CED3" stroke-width="2" />
                {#each tl.years as yr (yr)}<text x={tl.x(`${yr}-01-01`)} y="114" font-size="12" fill="#5C6268" text-anchor="middle">{yr}</text>{/each}
                {#each r.rainOnly as e, i (i)}<rect x={tl.x(e.peakDate) - 2.5} y="68" width="5" height="24" rx="2.5" fill="#B8BEC4" />{/each}
                {#each r.paid as e, i (i)}<rect x={tl.x(e.peakDate) - 3.5} y="14" width="7" height="78" rx="3.5" fill="#3DD27B" />{/each}
            </svg>
            <ol>
                {#each r.paid.slice().reverse() as e, i (i)}
                    <li>{rec.heat ? `${day(e.start)} to ${day(e.end)}, up to ${e.peak.toFixed(1)} °C` : rec.wind ? `${day(e.peakDate)}, gusts ${Math.round(e.peak)} km/h` : `${day(e.peakDate)}, river ${Math.round(e.peak)} m³/s`}</li>
                {/each}
            </ol>
            <p class="fine">{rec.note}</p>
        {/if}
    </div>
</article>

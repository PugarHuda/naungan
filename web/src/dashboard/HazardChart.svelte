<script lang="ts" module>
    import { floodChart, heatChart, windChart, type Chart } from "./chart"
    // One forecast fetch per program per page view; switching back and forth reuses it.
    const cache = new Map<string, Promise<Chart>>()
</script>

<script lang="ts">
    import type { ProgramMeta } from "../shared/chain"
    import { CHART } from "./chart"
    let { id, meta }: { id: bigint; meta: ProgramMeta } = $props()

    const heat = $derived(meta.hazard === "heat")
    const wind = $derived(meta.hazard === "wind")
    const what = $derived(heat ? "temperature" : wind ? "wind" : "river")
    let chart = $state<Chart | null>(null)
    let note = $state("")

    $effect(() => {
        const key = String(id), m = meta, kind = what
        chart = null
        note = kind === "river" ? "Fetching the GloFAS river forecast…" : `Fetching the NOAA GEFS ${kind} forecast…`
        let live = true
        if (!cache.has(key)) cache.set(key, kind === "temperature" ? heatChart(m) : kind === "wind" ? windChart(m) : floodChart(m))
        cache.get(key)!.then(
            (c) => live && ((chart = c), (note = c.note)),
            (e) => live && (note = `The ${kind} forecast is unavailable right now (${e.message}). The trigger panel still shows what the oracles posted.`)
        )
        return () => (live = false)
    })
    const { W, H, L, R, T, B } = CHART
</script>

<figure class="hydro" class:heat>
    <div class="legend" aria-hidden="true">
        <span>Median forecast</span><span class="l-band">{heat ? "Hottest ensemble member" : wind ? "Windiest ensemble member" : "Wettest ensemble member"}</span><span class="l-flood">{heat ? "Heatwave level" : wind ? "Return-period gust" : "Flood level"}</span><span class="l-lead">Trigger window</span>
    </div>
    <svg viewBox="0 0 {W} {H}" role="img" aria-label={heat ? "Daily maximum temperature forecast against the program's heatwave level" : wind ? "Daily peak wind gust forecast against the program's return-period gust" : "River discharge forecast for the next 30 days against the program's flood level"}>
        {#if chart}
            <rect x={chart.lead.x} y={chart.lead.y} width={chart.lead.w} height={chart.lead.h} fill="#F0F2F4" rx="6" />
            {#each chart.grid as g (g.y)}
                <line x1={L} x2={W - R} y1={g.y} y2={g.y} stroke="#E6E9EC" />
                <text x={L - 8} y={g.y + 4} font-size="12" fill="#5C6268" text-anchor="end">{g.label}</text>
            {/each}
            <path d={chart.area} fill={chart.areaFill} />
            <path d={chart.median} fill="none" stroke="#0A0B0F" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
            <line x1={L} x2={W - R} y1={chart.level.y} y2={chart.level.y} stroke="#A94F0B" stroke-width="2" stroke-dasharray="7 5" />
            <text x={W - R} y={chart.level.y - 8} fill="#A94F0B" font-size="13" font-weight="700" text-anchor="end">{chart.level.label}</text>
            <text x={L + 8} y={T + 18} fill="#5C6268" font-size="12">{chart.leadText}</text>
            <text x="14" y={T + (H - T - B) / 2} fill="#5C6268" font-size="12" transform="rotate(-90 14 {T + (H - T - B) / 2})" text-anchor="middle">{chart.axis}</text>
            {#each chart.xs as t (t.x)}
                <text x={t.x} y={H - 10} font-size="12" fill="#5C6268" text-anchor={t.anchor}>{t.label}</text>
            {/each}
        {/if}
    </svg>
    <figcaption>{note}</figcaption>
</figure>

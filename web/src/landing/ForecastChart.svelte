<script lang="ts">
    // GloFAS 30-day forecast: wettest member as a band, median as a line, the flood level dashed.
    import type { Forecast } from "./record"

    let { f, returnPeriod, id, label }: { f: Forecast | null; returnPeriod: number; id: string; label: string } = $props()

    const W = 260, H = 110
    const top = $derived(f ? Math.max(f.threshold * 1.15, ...f.max.filter((v): v is number => v != null)) : 1)
    const n = $derived(f?.time.length ?? 1)
    const x = (i: number) => (i / (n - 1)) * W
    const y = (v: number) => H - 14 - (v / top) * (H - 22)
    const line = (vals: (number | null)[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`).join("")
</script>

<svg {id} viewBox="0 0 260 110" role="img" aria-label={label}>
    {#if f}
        <path d="{line(f.max)}L{W},{H - 14}L0,{H - 14}Z" fill="rgba(61,210,123,.12)" />
        <path d={line(f.median)} fill="none" stroke="#3DD27B" stroke-width="2.2" stroke-linejoin="round" />
        <line x1="0" x2={W} y1={y(f.threshold)} y2={y(f.threshold)} stroke="#FFB36B" stroke-width="1" stroke-dasharray="4 4" />
        <text x={W} y={y(f.threshold) - 4} fill="#FFB36B" font-size="9" text-anchor="end">1-in-{returnPeriod}y flood {Math.round(f.threshold)} m³/s</text>
        {#each [0, 9, 19, 29].filter((i) => i < n) as i (i)}
            <text x={Math.min(Math.max(x(i), 8), W - 8)} y={H - 2} fill="#9AA1AB" font-size="8" text-anchor="middle">{f.time[i].slice(5)}</text>
        {/each}
    {/if}
</svg>

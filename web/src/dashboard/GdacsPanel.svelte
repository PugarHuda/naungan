<script lang="ts">
    // GDACS (UN OCHA / European Commission) flood and cyclone alerts near this program in the last 30 days, beside
    // the forecast trigger: an official, independent read of whether something is happening there now.
    import { dash } from "./state.svelte"
    import { day } from "./format"
    import { placeOf } from "../shared/place"
    import { alertsFor, TYPES, type Alert } from "../shared/gdacs"

    let el: HTMLElement
    let seen = $state(false)
    let data = $state.raw<{ pid: bigint; alerts: Alert[] } | null>(null)
    let error = $state<string | null>(null)
    const heat = $derived(dash.meta.hazard === "heat")

    $effect(() => {
        const o = new IntersectionObserver(([e]) => e.isIntersecting && ((seen = true), o.disconnect()), { rootMargin: "300px" })
        o.observe(el)
        return () => o.disconnect()
    })

    $effect(() => {
        const id = dash.pid, m = dash.meta
        data = null
        error = null
        if (!seen || heat || id === undefined || m.lat == null || m.lon == null) return
        ;(async () => {
            const cc = m.country ?? (await placeOf(m.lat!, m.lon!))?.code ?? null
            const alerts = await alertsFor({ lat: m.lat!, lon: m.lon!, cc })
            if (id === dash.pid) data = { pid: id, alerts }
        })().catch((e) => {
            if (id === dash.pid) error = (e as Error).message
        })
    })
    const current = $derived(data?.alerts.filter((a) => a.current) ?? [])
</script>

<article class="panel wide" aria-labelledby="gdacsH" bind:this={el}>
    <h2 id="gdacsH">Official alerts nearby</h2>
    <p class="lead-in">
        Flood and tropical cyclone alerts from <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>, the UN and European Commission’s global
        disaster alert system, in this program’s country or within 500 km of it over the last 30 days. Independent of this program’s oracles.
    </p>
    <div class="result" role="status">
        {#if heat}
            <div class="verdict">GDACS issues no heatwave alerts; this program’s trigger is the only warning shown here.</div>
        {:else if error}
            <div class="verdict bad">GDACS is unavailable right now ({error}). Try again later.</div>
        {:else if !data}
            <div class="verdict">{seen ? "Reading GDACS…" : ""}</div>
        {:else if !data.alerts.length}
            <div class="verdict ok">No GDACS flood or cyclone alert near this program in the last 30 days.</div>
        {:else}
            <div class="head">
                <b>{current.length ? `${current.length} active` : "None active"}</b>
                <span>{data.alerts.length} GDACS alert{data.alerts.length === 1 ? "" : "s"} near this program in the last 30 days</span>
            </div>
            <ul class="go">
                {#each data.alerts.slice(0, 10) as a (a.url)}
                    <li>
                        <span class="mark lvl {a.level.toLowerCase()}" title="{a.level} alert" aria-label="{a.level} alert">●</span>
                        <span class="when">{day(a.from)}</span>
                        <a href={a.url} target="_blank" rel="noopener">{a.name}</a>
                        <span class="meta">{TYPES[a.type]} · {a.level} alert · {a.km.toLocaleString("en")} km away{a.current ? " · active" : ` · until ${day(a.to)}`}</span>
                    </li>
                {/each}
            </ul>
            <p class="fine">A GDACS alert is not this program’s trigger: the trigger reads the river forecast at this point, and pays only when it crosses the rule above.</p>
        {/if}
    </div>
</article>

<style>
    .lvl.green { color: #3a9a5b }
    .lvl.orange { color: #d9822b }
    .lvl.red { color: #c8372d }
</style>

<script lang="ts">
    import { dash } from "./state.svelte"
    import { day, until, words } from "./format"
    import { level } from "./trigger"
    import HazardChart from "./HazardChart.svelte"
    import { CHART } from "./chart"

    const m = $derived(dash.meta)
    const w = $derived(words(m))
    // "Krueng Aceh flood · 2-of-2 watch 2026/27": the place is the headline, the rest goes in the label.
    const parts = $derived((m.name ?? (dash.pid === undefined ? "" : `Program ${dash.pid}`)).split(" · "))
    const p = $derived(dash.p)
    const on = $derived(!!p && p.claimDeadline > 0n)
    const open = $derived(!!p && on && dash.now <= Number(p.claimDeadline))
    const ended = $derived(!!p && !on && dash.now > Number(p.seasonEnd))
    const shown = $derived(p ? (on ? Number(p.lastIndex) : level(p, dash.reps, dash.now)) : 0)
    // A demo program can be opened by a replay of a past flood; its evidence says so, and so must this page.
    const fired = $derived(dash.current?.findLast((e) => e.fragment.name === "IndexReported" && e.args.triggered))
    // A flood or wind replay names its peak day; a heatwave replay only its window, so fall back to the window start.
    const replay = $derived.by(() => {
        const ev: string = fired?.args.evidence ?? ""
        return !/^REPLAY/.test(ev) ? null : (ev.match(/peak (?:gust )?[\d.]+ (?:m3\/s|km\/h) on (\d{4}-\d{2}-\d{2})/)?.[1] ?? ev.match(/window (\d{4}-\d{2}-\d{2})/)?.[1] ?? "a past date")
    })
    const line = $derived.by(() => {
        if (!p) return "Reading the contract on Base."
        if (open && replay) return `Claims are open after a labelled replay of the ${w.noun} of ${/\d/.test(replay) ? day(replay) : replay}, not a live forecast. Enrolled households can claim from a phone with their card.`
        if (open && fired) return `A ${w.noun} is forecast. Enrolled households can claim now, from a phone, with their card.`
        if (open) return "Claims are open. Enrolled households can claim now, from a phone, with their card. Reading what triggered it…"
        if (on) return "This program paid out and its claim window has closed. Donors can take back their share of what was not paid out."
        if (ended) return `This season ended without a ${w.noun} trigger. Each donor can take back their share of the pool below.`
        return `No ${w.noun} expected yet. The oracles put the chance of a ${w.noun}${m.leadDays ? ` in the next ${m.leadDays} days` : ""} at ${shown}%, and claims open at ${p.triggerThreshold}%.`
    })
    const small = $derived(!p ? "" : open ? `Claims close ${until(p.claimDeadline)}.` : on ? `Closed ${until(p.claimDeadline)}.` : ended ? "" : `Watching until ${until(p.seasonEnd)}. The oracles post every 6 hours.`)
    const chip = $derived(!p ? (dash.error ? "Offline" : "Connecting") : open ? "Claims open" : on ? "Claim window closed" : ended ? "Season ended" : "Watching")
</script>

<div class:on>
    <div class="verdictline">
        <span class="chip" class:on={open}><i></i>{chip}</span>
        <span class="plabel">{dash.pid === undefined ? "" : [`Program #${dash.pid}`, ...parts.slice(1)].join(", ")}</span>
    </div>
    <h1 id="pname">{dash.error && !p ? dash.error : dash.pid === undefined ? "Loading the program…" : parts[0]}</h1>
    <p class="say">{line}<small>{small}</small></p>
    {#if m.lat != null && dash.pid !== undefined}
        <HazardChart id={dash.pid} meta={m} />
    {:else if dash.pid === undefined || m.lat === undefined}
        <!-- Same box as the chart while the program's metadata loads, so the panels below never jump when it arrives (CLS). -->
        <figure class="hydro" aria-hidden="true">
            <div class="legend"><span>Median forecast</span></div>
            <svg viewBox="0 0 {CHART.W} {CHART.H}"></svg>
            <figcaption>Loading the forecast…</figcaption>
        </figure>
    {/if}
</div>

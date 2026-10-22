<script lang="ts">
    import { onMount } from "svelte"
    import ForecastChart from "./ForecastChart.svelte"
    import { forecast, type Forecast, type Live } from "./record"

    let { live }: { live: Live } = $props()

    let canvas: HTMLCanvasElement
    // No WebGL (old phone, blocked GPU): the hero keeps its plain canvas colour and the page works the same. Phones, Data
    // Saver and reduced motion skip the scene too (on a mid-range phone it cost about 4 s of main-thread time, Lighthouse),
    // and elsewhere it loads once the page is idle, so it never competes with the text and the live numbers.
    onMount(() => {
        const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
        if (saveData || matchMedia("(max-width: 760px), (prefers-reduced-motion: reduce)").matches || !document.createElement("canvas").getContext("webgl2")) return
        let stop: (() => void) | undefined, gone = false
        const go = () =>
            import("./hero3d.js")
                .then((m) => { if (!gone) stop = m.start(canvas) })
                .catch((e) => console.warn("3D scene unavailable:", e.message))
        const rich = "requestIdleCallback" in window
        const idle = rich ? requestIdleCallback(go, { timeout: 3000 }) : window.setTimeout(go, 1500)
        return () => ((gone = true), rich ? cancelIdleCallback(idle) : clearTimeout(idle), stop?.())
    })

    let f = $state<Forecast | null>(null)
    let note = $state("GloFAS 30-day river forecast")
    $effect(() => {
        const meta = live.featured
        if (!meta) return
        forecast(meta)
            .then((r) => ((f = r), (note = `GloFAS median (line) and wettest member (band), next 30 days, run ${r.time[0]}`)))
            .catch((e) => (note = `Forecast unavailable right now (${e.message})`))
    })
</script>

<section class="hero" aria-labelledby="h1">
    <canvas id="scene" aria-hidden="true" bind:this={canvas}></canvas>
    <div class="scene-fade" aria-hidden="true"></div>
    <div class="wrap">
        <div class="copy">
            <div class="eyebrow">Anticipatory cash · Asia, Africa, the Americas</div>
            <h1 id="h1">Cash before the flood</h1>
            <p class="lede">Naungan (“shelter”) pays families days before a forecast flood, cyclone or heatwave, never twice, and never reveals who they are.</p>
            <div class="ctas">
                <a class="btn go" href="dashboard">See it live on Base</a>
                <a class="btn plain" href="claim">Claim with a card →</a>
                <a class="btn plain" href="#demo">Watch the 90-second demo</a>
            </div>
        </div>
    </div>

    <div class="device" role="region" aria-label="Live program status, read from the chain">
        <div class="screen" aria-live="polite">
            <div class="s-top"><span class="live"><i></i><span>{live.net}</span></span><a class="mono" href={live.addrHref} target="_blank" rel="noopener" style="color:inherit">{live.addr}</a></div>
            <h2>{live.pname}</h2>
            <div class="s-date">{live.pdate || " "}</div>
            <div class="s-card">
                <div class="s-head"><span>Flood<br />probability</span>
                    <div class="s-kpis"><div class="s-kpi" class:on={live.fired}><small>{live.fired ? "Fired" : "Now"}</small><b>{live.now}</b></div><div class="s-kpi"><small>Trigger</small><b>{live.trig}</b></div></div>
                </div>
                <ForecastChart {f} returnPeriod={live.featured?.returnPeriod ?? 5} id="chart" label="GloFAS 30-day river forecast" />
                <div class="s-note">{note}</div>
            </div>
            <div class="s-tiles">
                <div class="s-tile"><b>{live.enrolled}</b><span>households in {live.nprog} programs, no names</span></div>
                <div class="s-tile"><b>{live.paid}</b><span>paid · {live.usd} USDC</span></div>
            </div>
        </div>
    </div>

    <div class="wrap chips">
        <div class="chip c1"><div class="tile"><svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M3 19c0-3 2.5-5 5-5s5 2 5 5M11 19c0-3 2.5-5 5-5s5 2 5 5" /></svg></div><div><b>Private dedup</b><span>agencies never share lists</span></div></div>
        <div class="chip c2"><div class="tile"><svg viewBox="0 0 24 24"><path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M12 3v7M9 7l3 3 3-3" /></svg></div><div><b>Two flood oracles</b><span>GloFAS river + NOAA rain, 2-of-2</span></div></div>
        <div class="chip c3"><div class="tile"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 7v10M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.5-2.6-1.5" /></svg></div><div><b>Gasless USDC</b><span>to a fresh address each time</span></div></div>
        <div class="chip c4"><div class="tile"><svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg></div><div><b>Zero-knowledge claim</b><span>proof made on the phone</span></div></div>
    </div>
</section>

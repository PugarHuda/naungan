<script lang="ts">
    // Embeddable status card: <iframe src="https://naungan.vercel.app/embed.html?program=N">. It reads the edge-cached
    // /api/programs (one CDN answer serves every site that embeds it, so no RPC load), refreshes every 5 minutes,
    // and links to the dashboard where every payout can be re-verified. ?theme=dark|light, else the visitor's.
    import { onMount } from "svelte"
    import { flagOf } from "../shared/place"

    type P = {
        id: number; name: string; hazard: "flood" | "heat"; country: string | null; state: "watching" | "claims open" | "over"
        until?: string; since?: string; seasonEnds?: string
        trigger: { rule: string; thresholdPercent: number; lastIndexPercent: number }
        usdc: { perHousehold: number; funded: number; paidOut: number }; households: { enrolled: number; paid: number }
        latestReport: { at: string } | null; links: { dashboard: string }
    }
    const q = new URLSearchParams(location.search)
    const id = Number(q.get("program"))
    const theme = q.get("theme")
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme

    let p = $state<P | null>(null)
    let err = $state<string | null>(null)
    const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "")
    const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

    async function load() {
        if (!Number.isInteger(id) || id < 1) return (err = "Add ?program=<id> to the address.")
        try {
            const r = await fetch("/api/programs")
            if (!r.ok) throw new Error()
            const found = ((await r.json()).programs as P[]).find((x) => x.id === id)
            if (!found) return (err = `There is no program #${id}.`)
            ;(p = found), (err = null)
        } catch {
            if (!p) err = "Program data is unavailable right now; retrying."
        }
    }
    onMount(() => {
        load()
        const t = setInterval(load, 5 * 60e3)
        return () => clearInterval(t)
    })
</script>

<main aria-live="polite">
    {#if p}
        <header>
            <span class="flag" aria-hidden="true">{flagOf(p.country ?? undefined)}</span>
            <h1>{p.name}</h1>
        </header>
        <p class="state {p.state.replace(' ', '-')}">
            {#if p.state === "claims open"}{p.hazard === "heat" ? "Heatwave" : "Flood"} trigger fired: claims open until {day(p.until)}
            {:else if p.state === "watching"}Watching the forecast until {day(p.seasonEnds)}
            {:else}Claims closed {day(p.since)}{/if}
        </p>
        <div class="meter" role="img" aria-label="Latest forecast {p.trigger.lastIndexPercent}% against a trigger of {p.trigger.thresholdPercent}%">
            <div class="fill" style="width:{Math.min(100, p.trigger.lastIndexPercent)}%"></div>
            <div class="mark" style="left:{p.trigger.thresholdPercent}%"></div>
        </div>
        <p class="small">Latest forecast <b>{p.trigger.lastIndexPercent}%</b> · trigger {p.trigger.thresholdPercent}%{p.latestReport ? ` · reported ${day(p.latestReport.at)}` : ""}</p>
        <dl>
            <div><dt>Pool</dt><dd>{money(p.usdc.funded)} USDC</dd></div>
            <div><dt>Paid out</dt><dd>{money(p.usdc.paidOut)} USDC</dd></div>
            <div><dt>Households paid</dt><dd>{p.households.paid} of {p.households.enrolled}</dd></div>
            <div><dt>Each household</dt><dd>{money(p.usdc.perHousehold)} USDC</dd></div>
        </dl>
        <p class="small rule">{p.trigger.rule}</p>
        <a href={p.links.dashboard} target="_blank" rel="noopener">Verify every payout on Naungan ↗</a>
    {:else}
        <p class="small">{err ?? "Loading program…"}</p>
    {/if}
</main>

<style>
    :global(:root) { --bg: #ffffff; --fg: #14181f; --muted: #5b6472; --line: #e3e6ea; --accent: #1f9d55; --warn: #c2410c; color-scheme: light }
    @media (prefers-color-scheme: dark) { :global(:root:not([data-theme="light"])) { --bg: #12161c; --fg: #eef1f4; --muted: #a3acb8; --line: #2a313b; --accent: #3dd27b; --warn: #fb923c; color-scheme: dark } }
    :global(:root[data-theme="dark"]) { --bg: #12161c; --fg: #eef1f4; --muted: #a3acb8; --line: #2a313b; --accent: #3dd27b; --warn: #fb923c; color-scheme: dark }
    :global(body) { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
    main { padding: 16px; max-width: 520px }
    header { display: flex; gap: 8px; align-items: center }
    h1 { font-size: 17px; margin: 0; font-weight: 700 }
    .state { margin: 8px 0; font-weight: 600 }
    .state.claims-open { color: var(--warn) }
    .meter { position: relative; height: 8px; border-radius: 4px; background: var(--line); margin: 10px 0 4px }
    .fill { height: 100%; border-radius: 4px; background: var(--accent) }
    .mark { position: absolute; top: -3px; width: 2px; height: 14px; background: var(--fg) }
    .small { font-size: 13px; color: var(--muted); margin: 4px 0 }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 12px 0 }
    dt { font-size: 12px; color: var(--muted) }
    dd { margin: 0; font-weight: 600 }
    .rule { margin-bottom: 10px }
    a { color: var(--accent); font-weight: 600 }
</style>

<script lang="ts">
    import { dash, type Report } from "./state.svelte"
    import { short, type Ev } from "./format"
    import { fresh } from "./trigger"

    let { oracle, report, last, kind, threshold, triggered }: { oracle: string; report: Report; last?: Ev; kind: string; threshold: bigint; triggered: boolean } = $props()

    const NAMES: Record<string, string> = { glofas: "River flow (GloFAS)", rain: "Rainfall (NOAA GEFS)", heat: "Max temperature (NOAA GEFS)", wind: "Peak wind gusts (NOAA GEFS)", "heat-ecmwf": "Max temperature (ECMWF ENS)", "wind-ecmwf": "Peak wind gusts (ECMWF ENS)" }
    const ago = (t: number) => {
        const h = (dash.now - t) / 3600
        return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`
    }
    const posted = $derived(report.ts > 0n)
    const isFresh = $derived(fresh(report, dash.now))
    // Results are keyed by the report's transaction, so they survive the 2 s refresh until a newer report lands.
    const key = $derived(last?.transactionHash)
    const check = $derived(key ? dash.checks[key] : undefined)

    // Recompute the report from Open-Meteo in this browser with the oracle's own code (lib/hazard.mjs).
    async function recheck(k: string, ev: Ev) {
        const meta = dash.meta, rep = { value: ev.args.value as bigint, evidence: ev.args.evidence as string }
        dash.checks[k] = { cls: "verdict", text: "Fetching the public forecast and recomputing… (up to a minute if the free API asks us to wait)" }
        try {
            const v = await import("../shared/verify.mjs")
            const r = await v.recheck(meta, rep)
            // Same value is not enough: the full evidence (threshold, members over, median) must match too.
            const same = r.value === Number(rep.value) && r.evidence === rep.evidence
            dash.checks[k] = {
                cls: `verdict ${!r.comparable ? "" : same ? "ok" : "bad"}`,
                text: !r.comparable
                    ? `Recomputed now: ${r.value}%. Not comparable with the posted ${rep.value}%: ${r.why}.`
                    : same ? `✓ Matches: recomputed ${r.value}% = on-chain ${rep.value}%, evidence identical (${r.why}).`
                    : `✗ Mismatch: recomputed ${r.value}% vs on-chain ${rep.value}% (${r.why}). Recomputed evidence: ${r.evidence}`
            }
        } catch (e) {
            dash.checks[k] = { cls: "verdict bad", text: `Could not recompute: ${(e as Error).message} `, retry: true }
        }
    }
</script>

<div class="oracle">
    <div class="top">
        <span class="name">{NAMES[kind] ?? "Oracle"}</span>
        <span class="val" class:hot={report.value >= threshold && isFresh}>{posted ? `${report.value}%` : "–"}</span>
    </div>
    <div class="sub">
        {short(oracle)}, {posted ? `posted ${ago(Number(report.ts))}` : "no report yet"}{#if !triggered && posted && !isFresh}<span class="stale">, expired and not counted</span>{/if}
    </div>
    {#if last && key}
        <details>
            <summary>Evidence posted on-chain</summary>
            <div class="evidence">{last.args.evidence}</div>
        </details>
        {#if check}
            <div class={check.cls} role="status">
                {check.text}{#if check.retry}<button class="recheck" type="button" onclick={() => recheck(key, last)}>Try again</button>{/if}
            </div>
        {:else}
            <button class="recheck" type="button" onclick={() => recheck(key, last)}>Recompute in my browser</button>
        {/if}
    {/if}
</div>

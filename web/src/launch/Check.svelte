<script lang="ts">
    // Step 3: check the trigger against live data before money depends on it. Every number is computed now, in
    // this browser, by the code the oracles run (lib/hazard.mjs), the dashboard's track record and IFRC GO.
    import { assess, assessHeat, assessWind, PAIRS, PIPELINES } from "../../../lib/hazard.mjs"
    import { trackRecord } from "../shared/verify.mjs"
    import { compare, eventsOf, societyOf, type GoEvent } from "../shared/ifrc"
    import { draft, metaOf } from "./draft.svelte"

    type Episode = { start: string; end: string; peak: number; peakDate: string }
    type Result = {
        hazard: "flood" | "heat" | "wind"
        level: string
        live: string
        years: number
        paid: Episode[]
        paidYears: number
        ifrc: { rows: (GoEvent & { caught: boolean })[]; caught: number; total: number } | null
        ifrcNote: string
    }

    let busy = $state(false)
    let error = $state("")
    let r = $state<Result | null>(null)
    const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

    async function run() {
        const built = metaOf()
        if ("error" in built) return void (error = built.error)
        const meta = built.meta as Record<string, any>
        busy = true
        error = ""
        r = null
        try {
            const heat = meta.hazard === "heat", wind = meta.hazard === "wind"
            // Each pipeline's own wording of today's forecast, so the two result shapes never mix.
            const today = async () => {
                if (wind) {
                    const w = await assessWind(meta)
                    return `${w.probability}% of ${w.members} NOAA GEFS members exceed it in the next ${meta.leadDays} days (median strongest gust ${Math.round(w.medianPeak)} km/h)`
                }
                if (heat) {
                    const h = await assessHeat(meta)
                    return `${h.probability}% of ${h.members} NOAA GEFS members forecast it in the next ${meta.leadDays} days (median hottest day ${h.medianHottest.toFixed(1)} °C)`
                }
                const f = await assess({ lat: meta.lat, lon: meta.lon, returnPeriod: meta.returnPeriod, leadDays: meta.leadDays })
                return `${f.probability}% of ${f.members} GloFAS members exceed it in the next ${meta.leadDays} days (median peak ${Math.round(f.medianPeak).toLocaleString("en")} m³/s)`
            }
            // A 2-of-2 program: today's reading from the independent pipeline too, in that pipeline's own words.
            const other = async () => {
                if (!draft.second) return ""
                const p = PAIRS[meta.hazard as "flood"][1] as keyof typeof PIPELINES, o = await (PIPELINES[p][0] as (m: object) => Promise<{ probability: number; members: number; evidence: string }>)(meta)
                return `; ${o.evidence.split(" via ")[0]}: ${o.probability}% of ${o.members} members`
            }
            const [live, second, record] = await Promise.all([today(), other(), trackRecord(meta)])
            const years = (Date.parse(record.flood.to) - Date.parse(record.flood.from)) / 3.156e10
            const paid = record.paid as Episode[]
            let ifrc = null, ifrcNote = ""
            // Ask for the society here rather than reading step 1's copy, which may still be loading (cached either way).
            const society = draft.place ? await societyOf(draft.place.code).catch(() => null) : null
            if (society) {
                try {
                    // GO sometimes files one response several times (same name and day): count it once.
                    const seen = new Set<string>()
                    const events = (await eventsOf(society, meta.hazard)).filter((e) => !seen.has(e.name + e.start) && !!seen.add(e.name + e.start))
                    ifrc = compare(events, paid, record.flood.from, record.flood.to)
                } catch (e) {
                    ifrcNote = `IFRC GO is unavailable right now (${(e as Error).message}).`
                }
            } else ifrcNote = draft.place ? "No national society found for this country on IFRC GO." : "The country of this place is unknown (offline?), so IFRC GO cannot be matched."
            r = {
                hazard: meta.hazard,
                level: wind
                    ? `1-in-${meta.returnPeriod}-year gust: ${Math.round(record.flood.threshold)} km/h (ERA5 daily peak)`
                    : heat
                    ? `${meta.heat.days}+ days above ${meta.heat.tmax} °C${meta.heat.tmin != null ? ` with nights above ${meta.heat.tmin} °C` : ""}`
                    : `1-in-${meta.returnPeriod}-year flood: ${Math.round(record.flood.threshold).toLocaleString("en")} m³/s`,
                live: live + second,
                years,
                paid,
                paidYears: new Set(paid.map((p) => p.start.slice(0, 4))).size,
                ifrc,
                ifrcNote
            }
        } catch (e) {
            error = `Could not check this trigger (${(e as Error).message}).`
        } finally {
            busy = false
        }
    }
</script>

<article class="panel step" aria-labelledby="checkH">
    <h2 id="checkH"><span class="n">3</span> Check before you launch</h2>
    <p class="fine">Recomputes the level, today’s forecast and the trigger replayed over 30–40 years of reanalysis, with the oracle’s own code.</p>
    <button class="btn go" type="button" onclick={run} disabled={busy}>{busy ? "Checking live data…" : "Check this trigger"}</button>
    {#if error}<p class="verdict bad" role="alert">{error}</p>{/if}
    {#if r}
        <dl class="facts">
            <dt>Level</dt><dd>{r.level}</dd>
            <dt>Today</dt><dd>{r.live}</dd>
            <dt>Track record</dt>
            <dd>
                {r.paid.length} payout{r.paid.length === 1 ? "" : "s"} in {Math.round(r.years)} years ({((r.paid.length / r.years) * 10).toFixed(1)} per decade){#if r.paid.length}, last {fmt(r.paid[r.paid.length - 1].start)}{/if}
            </dd>
        </dl>
        {#if r.paid.length === 0}
            <p class="warnbox" role="alert">This trigger never paid in {Math.round(r.years)} years of reanalysis. Households would likely never receive anything: lower the {{ heat: "temperature", wind: "gust size", flood: "flood size" }[r.hazard]}.</p>
        {:else if r.paidYears / r.years > 1 / 3}
            <p class="warnbox" role="alert">It pays in {r.paidYears} of {Math.round(r.years)} years, more than one year in three: the pool would empty on ordinary seasons. Raise the {{ heat: "temperature", wind: "gust size", flood: "flood size" }[r.hazard]}.</p>
        {/if}
        <h3>IFRC responses in this country</h3>
        {#if r.ifrc && r.ifrc.total === 0}
            <p class="fine">IFRC GO lists no {{ heat: "heatwave", wind: "cyclone", flood: "flood" }[r.hazard]} responses in this country over the record’s years.</p>
        {:else if r.ifrc}
            <p>
                Caught <b>{r.ifrc.caught} of {r.ifrc.total}</b> IFRC {{ heat: "heatwave", wind: "cyclone", flood: "flood" }[r.hazard]} responses within 30 days, over the record’s years.
                <span class="fine">Country-level context: a response may concern another river or city, so this is not a skill score.</span>
            </p>
            {#if r.ifrc.rows.length}
                <ul class="goev">
                    {#each r.ifrc.rows.slice(0, 12) as e (e.id)}
                        <li class:caught={e.caught}><span>{e.caught ? "✓" : "·"}</span> <a href={e.url} target="_blank" rel="noopener">{e.name}</a> <small>{fmt(e.start)}{e.appeals.length ? ` · ${e.appeals.join(", ")}` : ""}</small></li>
                    {/each}
                </ul>
            {/if}
        {:else}
            <p class="fine">{r.ifrcNote}</p>
        {/if}
    {/if}
</article>

<script lang="ts">
    // Any river: Open-Meteo's geocoder finds the place, then the same GloFAS code the oracle runs gives its
    // flood level, forecast and 30-year record. Nothing is stored; each search is a few public API calls.
    import { searchPlaces } from "../shared/place"
    import { trackRecord } from "../shared/verify.mjs"
    import { riverCell } from "../../../lib/hazard.mjs" // the same river snap the coordinator CLI and launch page use
    import ForecastChart from "./ForecastChart.svelte"
    import { fmt, forecast, years, type Forecast, type TrackRecord } from "./record"

    type Hit = { name: string; admin1?: string; country?: string; latitude: number; longitude: number }
    type Cell = { lat: number; lon: number; flow: number; km: number }

    let q = $state("")
    let hits = $state<Hit[]>([])
    let hitMsg = $state("")
    let picked = $state<Hit | null>(null)
    let cell = $state<Cell | null>(null)
    let r = $state<TrackRecord | null>(null)
    let f = $state<Forecast | null>(null)
    let fNote = $state("")
    let fFailed = $state(false)
    let error = $state("")

    async function search(e: SubmitEvent) {
        e.preventDefault()
        const query = q.trim()
        hits = []
        hitMsg = "Searching…"
        try {
            const found = await searchPlaces<(typeof hits)[number]>(query)
            if (!found.length) return void (hitMsg = `No place called “${query}” found. Try a city or district name.`)
            hits = found
            hitMsg = ""
        } catch (err) {
            hitMsg = `The place search is unavailable right now (${(err as Error).message}).`
        }
    }

    // A town's centre usually sits on a side stream, not the river that floods it. GloFAS answers 25 points in
    // one request, so look about 10 km around and take the cell with the largest recent mean flow.
    async function check(p: Hit) {
        picked = p
        cell = r = f = null
        fNote = error = ""
        fFailed = false
        try {
            const c: Cell = await riverCell(p.latitude, p.longitude)
            const meta = { name: p.name, lat: c.lat, lon: c.lon, returnPeriod: 5, leadDays: 10 }
            const rec: TrackRecord = await trackRecord(meta)
            if (picked !== p) return // another place was picked meanwhile
            cell = c
            r = rec
            // The record is already on screen: a forecast hiccup only blanks the chart, never the record.
            forecast(meta)
                .then((x) => { if (picked !== p) return; f = x; fNote = `GloFAS median (line) and wettest member (band), next 30 days, run ${x.time[0]}` + (x.peak >= x.threshold ? ". The forecast reaches the flood level in the next 10 days." : `. The next 10 days peak at ${Math.round(x.peak).toLocaleString("en")} m³/s, below the flood level.`) })
                .catch((e) => { if (picked === p) (fFailed = true), (fNote = `The 30-day forecast is unavailable right now (${e.message}).`) })
        } catch (err) {
            if (picked === p) error = `No river data for this point right now (${(err as Error).message}). Try again in a minute, or a nearby place.`
        }
    }
</script>

<section class="band" id="anywhere" aria-labelledby="anyH">
    <div class="wrap">
        <div class="eyebrow">Anywhere</div>
        <h2 class="big" id="anyH">Check any river on Earth.</h2>
        <p class="intro">The flood data covers rivers worldwide and the contract takes any location, so a program can run wherever floods are forecast. Search a place and this page works out, in your browser with the oracle’s own code, its 1-in-5-year flood level, the next 30 days of forecast and when the trigger would have paid since 1997. Matching names between agencies has a profile per region too (Indonesian and Malay, or basic for anywhere else).</p>
        <form class="anyform" onsubmit={search}>
            <label for="anyQ" style="position:absolute;left:-9999px">Place to check</label>
            <input id="anyQ" name="q" autocomplete="off" placeholder="Try Sylhet, Maiduguri, Piura or Kerala" required bind:value={q} />
            <button class="btn go" type="submit">Search places</button>
        </form>
        <ul class="hits" aria-label="Matching places">
            {#if hitMsg}<li>{hitMsg}</li>{/if}
            {#each hits as p, i (i)}
                <li><button type="button" aria-pressed={picked === p} onclick={() => check(p)}>{[p.name, p.admin1, p.country].filter(Boolean).join(", ")}</button></li>
            {/each}
        </ul>
        {#if picked}
            <div class="panel anyout" role="status">
                {#if error}
                    <h3>{picked.name}</h3>
                    <p class="caveat">{error}</p>
                {:else if !r || !cell}
                    <h3>{picked.name}, {picked.country ?? ""}</h3>
                    <p class="caveat">Finding the main river near this place, then reading about 30 years of its discharge from GloFAS… (up to a minute if the free API asks us to wait)</p>
                {:else}
                    <h3>{picked.name}, {[picked.admin1, picked.country].filter(Boolean).join(", ")}</h3>
                    <p class="caveat">Main river cell near {picked.name}: {cell.lat}, {cell.lon}, {cell.km < 1 ? "at the place itself" : `${Math.round(cell.km)} km away`}, mean flow {Math.round(cell.flow).toLocaleString("en")} m³/s over the last 3 months</p>
                    <div class="figs">
                        <div><b>{Math.round(r.flood.threshold).toLocaleString("en")} m³/s</b><span>1-in-5-year flood level here</span></div>
                        <div><b>{r.paid.length}</b><span>times the trigger would have paid in {years(r)} years</span></div>
                        <div><b>{r.paid.length ? fmt(r.paid.at(-1)!.peakDate) : "never"}</b><span>most recent payout</span></div>
                    </div>
                    {#if !fFailed}<ForecastChart {f} returnPeriod={5} id="anyChart" label="GloFAS 30-day river forecast for {picked.name}" />{/if}
                    <p class="caveat" id="anyNote">{fNote}</p>
                    <ul class="paid-list">
                        {#each r.paid.slice(-6).reverse() as e}<li><b>{fmt(e.peakDate)}</b>river peak {Math.round(e.peak).toLocaleString("en")} m³/s</li>{/each}
                    </ul>
                    {#if r.flood.threshold < 20}<p class="caveat">Even the largest river cell within about 10 km is a small stream, so a GloFAS trigger fits poorly here; a rainfall trigger would carry more weight.</p>{/if}
                    <p class="caveat">A perfect-forecast replay of a GloFAS-only trigger: how often a program here would pay, not how skilful forecasts are.</p>
                {/if}
            </div>
        {/if}
    </div>
</section>

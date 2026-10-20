<script lang="ts">
    // Step 1: the place. Open-Meteo's geocoder finds it; for a flood the oracle must read the river's main
    // channel, so riverCell (the same code `coordinator.js create --snap` runs) moves to the wettest GloFAS cell.
    import { riverCell } from "../../../lib/hazard.mjs"
    import { flagOf, placeOf } from "../shared/place"
    import { societyOf } from "../shared/ifrc"
    import { draft, suggestName, type Hit } from "./draft.svelte"

    let q = $state("")
    let hits = $state<Hit[]>([])
    let msg = $state("")
    let snapping = $state(false)
    let societyLoading = $state(false)

    async function search(e: SubmitEvent) {
        e.preventDefault()
        const query = q.trim()
        hits = []
        msg = "Searching…"
        try {
            const res = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`)).json()
            if (!res.results?.length) return void (msg = `No place called “${query}” found. Try a city or district name.`)
            hits = res.results
            msg = ""
        } catch (err) {
            msg = `The place search is unavailable right now (${(err as Error).message}).`
        }
    }

    // Only floods need the river cell (a heavy GloFAS request), so a heatwave launch never asks for it.
    function snap(h: Hit) {
        snapping = true
        return riverCell(h.latitude, h.longitude)
            .then((c) => draft.hit === h && (draft.cell = c))
            .catch((e: Error) => draft.hit === h && (draft.snapError = e.message))
            .finally(() => (snapping = false))
    }
    $effect(() => {
        const h = draft.hit
        if (h && draft.hazard === "flood" && !draft.cell && !draft.snapError && !snapping) snap(h)
    })

    async function pick(h: Hit) {
        hits = []
        q = h.name
        Object.assign(draft, { hit: h, cell: null, snapError: "", place: null, society: null })
        const snapped = draft.hazard === "flood" ? snap(h) : null
        const where = placeOf(h.latitude, h.longitude).then(async (p) => {
            if (draft.hit !== h) return
            draft.place = p
            if (!p) return
            societyLoading = true
            draft.society = await societyOf(p.code).catch(() => null)
            societyLoading = false
        })
        await Promise.all([snapped, where])
        suggestName()
    }
</script>

<article class="panel step" aria-labelledby="whereH">
    <h2 id="whereH"><span class="n">1</span> Where</h2>
    <form class="search" onsubmit={search}>
        <label for="place" class="sr">Place</label>
        <input id="place" bind:value={q} autocomplete="off" placeholder="Town or district, e.g. Butaleja or Tocoa" required />
        <button class="btn dark" type="submit">Search</button>
    </form>
    {#if msg}<p class="fine" role="status">{msg}</p>{/if}
    {#if hits.length}
        <ul class="hits" aria-label="Matching places">
            {#each hits as h (h.latitude + "," + h.longitude)}
                <li><button type="button" class="btn ghost" onclick={() => pick(h)}>{h.name}{h.admin1 ? `, ${h.admin1}` : ""}{h.country ? `, ${h.country}` : ""}</button></li>
            {/each}
        </ul>
    {/if}
    {#if draft.hit}
        <div class="placecard">
            <p class="big">{flagOf(draft.place?.code)} {draft.hit.name}{draft.place?.name ? `, ${draft.place.name}` : ""}</p>
            <p class="fine">
                {#if societyLoading}Looking up the national society on IFRC GO…{:else if draft.society}National society: <a href={draft.society.url ?? "https://go.ifrc.org"} target="_blank" rel="noopener">{draft.society.society}</a>{:else if draft.place}No national society listed on IFRC GO for {draft.place.code}{:else}Looking up the country…{/if}
            </p>
            <p class="fine">
                {#if snapping}Finding the river’s main channel…
                {:else if draft.cell}River cell {draft.cell.lat}, {draft.cell.lon}: moved {draft.cell.km.toFixed(1)} km to the main channel, mean {Math.round(draft.cell.flow).toLocaleString("en")} m³/s last year.
                {:else if draft.snapError}No river for a flood trigger here ({draft.snapError}). A heatwave trigger still works.{/if}
            </p>
        </div>
    {/if}
</article>

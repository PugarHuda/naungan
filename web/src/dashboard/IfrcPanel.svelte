<script lang="ts">
    // IFRC GO's record of the floods, heatwaves or cyclones the Red Cross / Red Crescent responded to in this program's
    // country, set against the trigger's replayed payouts. Country-level context, not a skill score.
    import { dash } from "./state.svelte"
    import { day } from "./format"
    import { record, loadRecord } from "./record.svelte"
    import { placeOf } from "../shared/place"
    import { societyOf, eventsOf, compare, type Society, type GoEvent } from "../shared/ifrc"

    let el: HTMLElement
    let seen = $state(false)
    let data = $state.raw<{ pid: bigint; country: string; society: Society | null; events: GoEvent[] } | null>(null)
    let error = $state<string | null>(null)
    let early = $state<string | null>(null)

    const kind = $derived(({ heat: "heatwave", wind: "cyclone" } as Record<string, string>)[dash.meta.hazard ?? ""] ?? "flood")

    // GO's country list is ~250 kB once a month: fetch only when the panel comes into view.
    $effect(() => {
        const o = new IntersectionObserver(([e]) => e.isIntersecting && ((seen = true), o.disconnect()), { rootMargin: "300px" })
        o.observe(el)
        return () => o.disconnect()
    })

    $effect(() => {
        const id = dash.pid, m = dash.meta
        data = null
        error = null
        early = null
        if (!seen || id === undefined || m.lat == null || m.lon == null) return
        ;(async () => {
            const place = m.country ? { code: m.country, name: undefined } : await placeOf(m.lat!, m.lon!)
            if (!place) throw new Error("could not tell which country this program is in")
            const society = await societyOf(place.code)
            // GO sometimes files one response twice (same name, same day); count it once.
            const seenKeys = new Set<string>()
            const events = (society ? await eventsOf(society, m.hazard === "heat" || m.hazard === "wind" ? m.hazard : "flood") : []).filter((e) => {
                const k = `${e.start}|${e.name.toLowerCase()}`
                return !seenKeys.has(k) && !!seenKeys.add(k)
            })
            if (id === dash.pid) data = { pid: id, country: society?.country ?? place.name ?? place.code, society, events }
        })().catch((e) => {
            if (id === dash.pid) error = (e as Error).message
        })
    })

    const cmp = $derived.by(() => {
        const r = record.pid === dash.pid ? record.r : null
        if (!r || !data) return null
        return compare(data.events, r.paid, r.flood.from, r.flood.to)
    })
    const rows = $derived(cmp ? cmp.rows : (data?.events ?? []))
    const sinceYear = $derived(record.r ? record.r.flood.from.slice(0, 4) : "")

    async function replay() {
        early = null
        try {
            await loadRecord()
        } catch (e) {
            early = (e as Error).message
        }
    }
</script>

<article class="panel wide" aria-labelledby="ifrcH" bind:this={el}>
    <h2 id="ifrcH">When the Red Cross responded</h2>
    <p class="lead-in">
        IFRC GO’s public record of the {kind}s the Red Cross and Red Crescent responded to in this country (DREF, emergency appeals, early action), set against this
        program’s replayed payouts.
    </p>
    <div class="result" role="status">
        {#if error}
            <div class="verdict bad">IFRC GO is unavailable right now ({error}). Try again later.</div>
        {:else if !data}
            <div class="verdict">{seen ? "Reading IFRC GO…" : ""}</div>
        {:else if !data.society}
            <div class="verdict">IFRC GO lists no national society for {data.country}.</div>
        {:else}
            <p class="fine" style="margin-top:0">
                National society: {#if data.society.url}<a href={data.society.url} target="_blank" rel="noopener">{data.society.society}</a>{:else}{data.society.society}{/if}
            </p>
            {#if !data.events.length}
                <div class="verdict">IFRC GO records no {kind} response in {data.country}.</div>
            {:else}
                {#if cmp}
                    <div class="head">
                        <b>{cmp.caught} of {cmp.total}</b>
                        <span>IFRC {kind} responses in {data.country} since {sinceYear} came within 30 days of a payout this trigger would have made</span>
                    </div>
                {:else}
                    <p class="fine">{data.events.length} {kind} responses on record.</p>
                    {#if !(record.pid === dash.pid && record.busy)}
                        <button class="btn dark" type="button" onclick={replay}>Compare with the trigger’s replay</button>
                    {:else}
                        <div class="verdict">Replaying the trigger…</div>
                    {/if}
                    {#if early}<div class="verdict">{early}</div>{/if}
                    {#if record.pid === dash.pid && record.error}<div class="verdict bad">Could not replay the trigger ({record.error}).</div>{/if}
                {/if}
                <ul class="go">
                    {#each rows.slice(0, 12) as e (e.id)}
                        <li>
                            {#if cmp}<span class="mark" class:hit={"caught" in e && e.caught} aria-label={"caught" in e && e.caught ? "near a payout" : "no payout nearby"}>{"caught" in e && e.caught ? "✓" : "–"}</span>{/if}
                            <span class="when">{day(e.start)}</span>
                            <a href={e.url} target="_blank" rel="noopener">{e.name}</a>
                            <span class="meta">{[...e.appeals, e.affected ? `${e.affected.toLocaleString("en")} affected` : ""].filter(Boolean).join(" · ")}</span>
                        </li>
                    {/each}
                </ul>
                {#if rows.length > 12}<p class="fine">and {rows.length - 12} earlier responses on <a href="https://go.ifrc.org/" target="_blank" rel="noopener">go.ifrc.org</a>.</p>{/if}
            {/if}
            <p class="fine">
                Country-level context, not a measure of forecast skill: an IFRC response can concern another river or region, and a payout can anticipate a {kind} that
                needed no international response.
            </p>
        {/if}
    </div>
</article>

<script lang="ts">
    // Everything on this page is live: totals and the featured flood program from the contract, its forecast
    // from GloFAS, its track record recomputed here with the oracles' code (shared/verify.mjs → lib/hazard.mjs).
    import { onMount } from "svelte"
    import { formatUnits } from "ethers"
    import { deployment as d, readPrograms, short, type Program, type ProgramMeta } from "../shared/chain"
    import Nav from "./Nav.svelte"
    import Hero from "./Hero.svelte"
    import Story from "./Story.svelte"
    import TrackRecord from "./TrackRecord.svelte"
    import Programs from "./Programs.svelte"
    import RiverCheck from "./RiverCheck.svelte"
    import Context from "./Context.svelte"
    import Built from "./Built.svelte"
    import type { FloodMeta, Live } from "./record"

    const addrHref = d.explorer ? `${d.explorer}/address/${d.naungan}` : undefined
    let live = $state<Live>({ net: `Live on ${d.network}`, addr: short(d.naungan), addrHref, pname: "Reading the chain…", pdate: "", now: "–", trig: "–", fired: false, enrolled: "–", paid: "–", usd: "–", nprog: "all" })
    let programs = $state.raw<{ id: number; p: Program; meta: ProgramMeta }[] | null>(null)
    let error = $state("")
    let featured = $state<(FloodMeta & { name: string }) | undefined>()

    onMount(async () => {
        try {
            const all = await readPrograms()
            programs = all
            if (!all.length) return void (live.pname = "No program yet")
            // The river chart and track record are flood views: feature the newest 2-of-2 flood program
            // (GloFAS + rainfall), else the newest flood program. Heat and wind programs have their own dashboard views.
            const flood = (m: ProgramMeta) => Boolean(m.lat) && (m.hazard ?? "flood") === "flood"
            let at = all.findLastIndex((x) => flood(x.meta) && x.meta.rain)
            if (at < 0) at = all.findLastIndex((x) => flood(x.meta))
            if (at < 0) at = all.length - 1
            const { p, meta, id } = all[at]
            const sum = (f: (p: Program) => bigint) => all.reduce((s, x) => s + f(x.p), 0n)
            const fm = flood(meta) ? ({ ...meta, name: meta.name ?? `Program ${id}` } as FloodMeta & { name: string }) : undefined
            featured = fm
            live = {
                ...live,
                nprog: String(all.length), // totals span every program, the chart is the featured one
                enrolled: String(sum((p) => p.enrolled)),
                paid: String(sum((p) => p.claims)),
                usd: Number(formatUnits(sum((p) => p.claims * p.amountPerHousehold), 6)).toLocaleString("en", { maximumFractionDigits: 2 }),
                pname: (meta.name ?? `Program ${id}`).split(" · ")[0],
                pdate: `Program #${id} · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
                now: `${p.lastIndex}%`,
                trig: `${p.triggerThreshold}%`,
                fired: p.claimDeadline > 0n,
                featured: fm
            }
        } catch (e) {
            console.error(e)
            error = (e as Error).message
            live = { ...live, net: "Deployment unavailable", pname: "Chain unreachable" }
        }
    })
</script>

<div class="frame">
    <Nav />
    <main>
        <Hero {live} />
        <Story />
        <TrackRecord meta={featured} />
        <Programs {programs} {error} />
        <RiverCheck />
        <Context />
        <Built contract={short(d.naungan)} contractHref={addrHref} />
    </main>
    <footer><div class="wrap"><span>Naungan · Pugar Huda Mantoro · Web3 for Social Good 2026</span><span>SMU × GSR Foundation × University of Málaga</span></div></footer>
</div>

<script lang="ts">
    import { dash } from "./state.svelte"

    const agencies = $derived.by(() => {
        const s = new Set<string>()
        for (const e of dash.current ?? []) e.fragment.name === "AgencyAdded" ? s.add(e.args.agency) : e.fragment.name === "AgencyRemoved" && s.delete(e.args.agency)
        return s.size
    })
    // One dot per household (scaled past 240 so the grid stays readable); filled dots carry no identity.
    const dots = $derived.by(() => {
        const p = dash.p
        if (!p) return { per: 1, total: 0, filled: 0 }
        const per = p.enrolled > 240n ? Math.ceil(Number(p.enrolled) / 240) : 1
        return { per, total: Math.ceil(Number(p.enrolled) / per), filled: Math.floor(Number(p.claims) / per) }
    })
</script>

<div>
    <h2>Households</h2>
    <p class="lead-in">
        {dash.current ? `Enrolled by ${agencies} ${agencies === 1 ? "agency" : "agencies"} that never share their lists.` : "Enrolled by agencies that never share their lists."}
    </p>
    <div class="big"><span>{dash.p ? String(dash.p.claims) : "–"}</span> <small>of <span>{dash.p ? String(dash.p.enrolled) : "–"}</span> paid</small></div>
    <div class="dots" role="img" aria-label={dash.p ? `${dash.p.claims} of ${dash.p.enrolled} households paid` : "Households paid out of enrolled"}>
        {#each { length: dots.total }, i (i)}<i class:paid={i < dots.filled}></i>{/each}
    </div>
    <p class="fine">{dots.per > 1 ? `Each dot is ${dots.per} households` : "One dot per household"}, in no particular order: the chain cannot tell which one was paid.</p>
</div>

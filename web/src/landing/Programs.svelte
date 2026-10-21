<script lang="ts">
    // Every program on the contract as a card: where it runs (country from its on-chain coordinates), its
    // trigger rule and its state. Newest first.
    import { formatUnits } from "ethers"
    import { isHeat, isOver, shortfall, type Program, type ProgramMeta } from "../shared/chain"
    import { flagOf, placeOf, type Place } from "../shared/place"

    let { programs, error }: { programs: { id: number; p: Program; meta: ProgramMeta }[] | null; error: string } = $props()

    let places = $state<(Place | null)[] | null>(null)
    $effect(() => {
        if (!programs) return
        Promise.all(programs.map(({ meta: m }) => (Number.isFinite(m.lat) && Number.isFinite(m.lon) ? placeOf(m.lat!, m.lon!) : null))).then((x) => (places = x))
    })

    const rule = (p: Program, m: ProgramMeta) =>
        isHeat(m)
            ? `Heatwave: ${m.heat?.days ?? 2}+ days above ${m.heat?.tmax ?? 38} °C${m.heat?.tmin != null ? `, nights above ${m.heat.tmin} °C` : ""}, ≥${p.triggerThreshold}% of NOAA GEFS members, ${m.leadDays}-day lead`
            : `River flood: ≥${p.triggerThreshold}% of GloFAS members above the 1-in-${m.returnPeriod}-year flood, ${m.leadDays}-day lead${m.rain ? ", confirmed by NOAA GEFS rainfall (2-of-2)" : ""}`
    const status = (p: Program): [string, string] => (isOver(p) ? ["Over", "over"] : p.claimDeadline > 0n ? ["Claims open", "open"] : [`Watching · ${p.lastIndex}%`, ""])
    const count = (k: "code" | "continent") => new Set(places!.map((x) => x?.[k]).filter(Boolean)).size

    const summary = $derived(
        error ? `Programs unavailable right now (${error}).`
        : programs && places ? `${programs.length} programs in ${count("code")} countries on ${count("continent")} continents, live on the contract now.`
        : "Reading every program from the contract…"
    )
</script>

<section class="band" id="programs" aria-labelledby="worldH">
    <div class="wrap">
        <div class="eyebrow">Live programs</div>
        <h2 class="big" id="worldH">Wherever a disaster can be forecast.</h2>
        <p class="intro"><span id="worldSum">{summary}</span> Each one runs on the trigger the local Red Cross or Red Crescent society already uses in its Early Action Protocol, from the same global forecasts, and pays in USDC that households see in their own currency and language.</p>
        <ul class="world" aria-live="polite">
            {#if programs && places}
                {#each programs.map((x, i) => ({ ...x, c: places![i] })).reverse() as { id, p, meta, c } (id)}
                    {@const [st, cls] = status(p)}
                    {@const need = shortfall(p)}
                    <li>
                        <a class="panel" href="dashboard?program={id}">
                            <span class="where">{flagOf(c?.code)} {c?.name ?? "Unknown place"} · #{id}</span>
                            <h3>{(meta.name ?? `Program ${id}`).split(" · ")[0]}</h3>
                            <p class="rule">{rule(p, meta)}</p>
                            <div class="meta"><span class="st {cls}">{st}</span><span class="pool">{Number(formatUnits(p.funded, 6))} USDC · {p.claims}/{p.enrolled} paid</span></div>
                            {#if need > 0n}<p class="need">Needs {Number(formatUnits(need, 6))} USDC more to pay every enrolled household</p>{/if}
                        </a>
                    </li>
                {/each}
            {/if}
        </ul>
    </div>
</section>

<script lang="ts">
    // Step 2: the trigger. Presets are published Red Cross / Red Crescent Early Action Protocols (lib/program.mjs);
    // every field stays editable, and editing one makes it a custom trigger.
    import { PRESETS } from "../../../lib/program.mjs"
    import { applyPreset, draft, suggestName } from "./draft.svelte"

    const chosen = $derived(PRESETS.find((p) => p.id === draft.preset))
    const custom = () => (draft.preset = "")
    function setHazard(h: "flood" | "heat" | "wind") {
        if (draft.hazard === h) return
        draft.hazard = h
        if (h !== "flood") draft.leadDays = Math.min(draft.leadDays, 16)
        if (h === "wind") draft.returnPeriod = 10 // pays on Haiyan 2013 at Tacloban and Idai 2019 at Beira; check the record below
        custom()
        suggestName()
    }
</script>

<article class="panel step" aria-labelledby="trigH">
    <h2 id="trigH"><span class="n">2</span> Trigger</h2>
    <fieldset class="seg">
        <legend class="sr">Hazard</legend>
        <label><input type="radio" name="hazard" checked={draft.hazard === "flood"} onchange={() => setHazard("flood")} /> River flood</label>
        <label><input type="radio" name="hazard" checked={draft.hazard === "heat"} onchange={() => setHazard("heat")} /> Heatwave</label>
        <label><input type="radio" name="hazard" checked={draft.hazard === "wind"} onchange={() => setHazard("wind")} /> Cyclone wind</label>
    </fieldset>
    <label for="preset">Start from a protocol</label>
    <select id="preset" value={draft.preset} onchange={(e) => (applyPreset(e.currentTarget.value), suggestName())}>
        {#each PRESETS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
        <option value="">Custom trigger</option>
    </select>
    {#if chosen}
        <p class="fine">{chosen.rule}. <a href={chosen.source} target="_blank" rel="noopener">Source</a></p>
    {/if}
    {#if draft.hazard === "wind"}
        <p class="fine">Pays when enough NOAA GEFS members forecast a daily peak gust above this place’s 1-in-N-year gust in ERA5. Both grids smooth a cyclone’s core (ERA5 gives Haiyan 124 km/h at Tacloban, against 300+ measured), so the level is the place’s own record on the same grid, not a storm category.</p>
    {/if}
    <div class="fields">
        {#if draft.hazard === "flood"}
            <label>Flood size (1-in-N years)<input type="number" min="1.1" max="100" step="0.1" bind:value={draft.returnPeriod} oninput={custom} /></label>
        {:else if draft.hazard === "wind"}
            <label>Gust size (1-in-N years)<input type="number" min="1.1" max="100" step="0.1" bind:value={draft.returnPeriod} oninput={custom} /></label>
        {:else}
            <label>Day temperature above (°C)<input type="number" min="25" max="60" step="0.5" bind:value={draft.tmax} oninput={custom} /></label>
            <label>Night temperature above (°C, optional)<input type="number" min="10" max="45" step="0.5" bind:value={draft.tmin} oninput={custom} /></label>
            <label>Consecutive days<input type="number" min="1" max="10" step="1" bind:value={draft.days} oninput={custom} /></label>
        {/if}
        <label>Lead time (days)<input type="number" min="1" max={draft.hazard === "flood" ? 30 : 16} step="1" bind:value={draft.leadDays} oninput={custom} /></label>
        <label>Trigger (% of forecast members)<input type="number" min="1" max="100" step="1" bind:value={draft.trigger} oninput={custom} /></label>
    </div>
</article>

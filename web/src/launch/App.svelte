<script lang="ts">
    import { deployment as d, short } from "../shared/chain"
    import Where from "./Where.svelte"
    import Trigger from "./Trigger.svelte"
    import Check from "./Check.svelte"
    import Launch from "./Launch.svelte"
</script>

<div class="frame">
    <nav aria-label="Launch">
        <a class="brand" href="./">NAUNGAN</a>
        <div class="navlinks">
            <span class="net">{d.network} {#if d.explorer}<a href="{d.explorer}/address/{d.naungan}" target="_blank" rel="noopener">{short(d.naungan)}</a>{:else}{short(d.naungan)}{/if}</span>
            <a class="btn ghost" href="dashboard">Live programs</a>
        </div>
    </nav>
    <main class="launch">
        <header>
            <h1>Launch a program</h1>
            <p class="say">Pick a place and a trigger your Red Cross or Red Crescent society already uses, check it against live forecasts and 30 years of history, then create it from your own wallet. No command line.</p>
        </header>
        <Where />
        <Trigger />
        <Check />
        <Launch />
    </main>
</div>

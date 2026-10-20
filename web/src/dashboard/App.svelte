<script lang="ts">
    import { deployment as d } from "../shared/chain"
    import { dash, select, start } from "./state.svelte"
    import { netName, short } from "./format"
    import HazardCard from "./HazardCard.svelte"
    import TriggerScreen from "./TriggerScreen.svelte"
    import PoolPanel from "./PoolPanel.svelte"
    import HouseholdsPanel from "./HouseholdsPanel.svelte"
    import DonatePanel from "./DonatePanel.svelte"
    import AuditPanel from "./AuditPanel.svelte"
    import TrackRecord from "./TrackRecord.svelte"
    import Ledger from "./Ledger.svelte"

    start()
    const ids = $derived(Object.keys(dash.metas).map(BigInt))
</script>

<div class="frame">
    <nav aria-label="Dashboard">
        <a class="brand" href="./">NAUNGAN</a>
        <div class="picker">
            <label for="prog" style="position:absolute;left:-9999px">Program</label>
            <select id="prog" value={dash.pid === undefined ? "" : String(dash.pid)} onchange={(e) => select(BigInt(e.currentTarget.value))}>
                {#if !ids.length}<option value="">Loading programs…</option>{/if}
                {#each ids as id (id)}<option value={String(id)}>#{String(id)}&nbsp;&nbsp;{dash.metas[String(id)].name}</option>{/each}
            </select>
        </div>
        <div class="navlinks">
            <span class="net">{netName} {#if d.explorer}<a href="{d.explorer}/address/{d.naungan}" target="_blank" rel="noopener">{short(d.naungan)}</a>{:else}{short(d.naungan)}{/if}</span>
            <a class="btn ghost" href="claim.html">Claim with a card</a>
            <a class="btn dark" href="#fund">Fund this program</a>
        </div>
    </nav>

    <main>
        <section class="hero" aria-labelledby="pname">
            <HazardCard />
            <TriggerScreen />
        </section>

        <section class="band" id="fund" aria-label="Money and households">
            <PoolPanel />
            <HouseholdsPanel />
            <DonatePanel />
        </section>

        <section class="proofs" aria-label="Checks you can run">
            <AuditPanel />
            <TrackRecord />
        </section>

        <section class="bottom">
            <Ledger />
            <article class="panel" aria-labelledby="neverH">
                <h2 id="neverH">What the chain never sees</h2>
                <ul class="never">
                    <li>Names, ID numbers, villages <b>0</b></li>
                    <li>Which agency serves which household <b>0</b></li>
                    <li>Which household received which payment <b>0</b></li>
                    <li>Any agency’s beneficiary list <b>0</b></li>
                </ul>
                <p class="fine">Every number on this page is rebuilt from public chain events, so anyone can check it. Agencies find shared households with private set intersection, and families claim with a zero-knowledge proof.</p>
            </article>
        </section>
    </main>
    <footer>Contract {d.naungan} on chain {d.chainId}. This page reads it every 2 seconds and keeps no data of its own.</footer>
</div>

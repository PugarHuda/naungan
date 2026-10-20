<script lang="ts">
    let { contract, contractHref }: { contract: string; contractHref?: string } = $props()
</script>

<section class="band" id="built">
  <div class="wrap">
    <div class="eyebrow">Built, not just pitched</div>
    <h2 class="big">A working prototype you can verify yourself.</h2>
    <p class="intro">Real Groth16 proofs generated on the phone and verified on-chain, a hosted gas relayer, an authenticated agency dedup service, two independent flood oracles (GloFAS river discharge and NOAA GEFS rainfall, 2-of-2 quorum) running every 6 hours and 40 automated tests. From the dashboard anyone can re-run an oracle's computation, or re-verify every payout's zero-knowledge proof from its raw transaction, in their own browser.</p>
    <video id="demo" class="demo" controls preload="none" poster="/demo-poster.jpg" aria-label="Two-minute captioned walkthrough of the live app"><source src="/demo.mp4" type="video/mp4" /></video>
    <div class="built">
      <a class="panel card" href="dashboard.html"><h3>Live dashboard →</h3><p>Totals rebuilt from chain events only, refreshed every two seconds, with a one-click audit of every payout’s proof.</p></a>
      <a class="panel card" id="contractCard" href={contractHref} target="_blank" rel="noopener"><h3>Contract on Basescan →</h3><p class="mono" id="contract">{contract}</p></a>
      <a class="panel card" href="https://github.com/PugarHuda/naungan" target="_blank" rel="noopener"><h3>Source on GitHub →</h3><p>Contracts, PSI library, tests and the full Aceh demo. MIT licensed.</p></a>
    </div>
  </div>
</section>

<section class="band closing">
  <div class="wrap">
    <h2 class="big">Built with agencies and communities, not for them.</h2>
    <p class="intro">Looking for one NGO and one zakat or humanitarian partner to co-design the Aceh pilot.</p>
    <div class="ctas">
      <a class="btn go" href="dashboard.html">Open the live dashboard</a>
      <a class="btn plain" href="https://github.com/PugarHuda/naungan" target="_blank" rel="noopener">GitHub →</a>
    </div>
  </div>
</section>

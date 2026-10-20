<section class="band" id="problem">
  <div class="wrap">
    <div class="eyebrow">The problem</div>
    <h2 class="big">Aid coordination forces a trade-off between efficiency and safety.</h2>
    <p class="intro">When many agencies serve one crisis, families get paid twice or missed. The usual fix, one shared registry, concentrates the most dangerous data in the world in one place.</p>
    <div class="problems">
      <div class="panel problem"><div class="num">$35M</div><h3>of overlap caught in Ukraine</h3><p>18 organisations coordinating USD 337M found duplicates worth enough to reach 185,000 more people for three months.</p><small>WFP Building Blocks · OECD OPSI</small></div>
      <div class="panel problem"><div class="num">600k</div><h3>households exposed in one breach</h3><p>Names, ID numbers and locations of aid recipients leaked from a central system. For refugees, exposure can mean detention.</p><small>WFP Gaza 2026, ICRC 2022 (515k people)</small></div>
      <div class="panel problem"><div class="num">10% → 2.5%</div><h3>cost when aid is pre-committed</h3><p>A trigger-based pilot in Kenya cut transaction costs fourfold, settled near-instantly, and 77% of families reported less financial stress.</p><small>Mercy Corps anticipatory cash pilot</small></div>
    </div>
  </div>
</section>

<section class="band" id="how">
  <div class="wrap">
    <div class="eyebrow">How it works</div>
    <h2 class="big">Four layers. No agency ever sees another’s list.</h2>
    <p class="intro">Each layer removes one reason agencies refuse to coordinate, and the chain only ever stores commitments, nullifiers and totals.</p>
    <div class="steps">
      <div class="panel step"><div class="tile"><svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c0-3 2.5-5 5-5s5 2 5 5M11 19c0-3 2.5-5 5-5s5 2 5 5"/></svg></div><h3>Private dedup</h3><p>Agencies compare lists with private set intersection. Each learns only “already served?” for its own records. Teuku Umar and T. Oemar still match; near matches go to a person.</p><span class="tag">DDH-PSI · ristretto255</span></div>
      <div class="panel step"><div class="tile"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h4M8 14h8"/></svg></div><h3>Anonymous enrollment</h3><p>Each family holds its own credential: a printed card, optionally PIN-locked, or one its own phone makes so that not even the agency can spot its claim. Agencies enroll only a cryptographic commitment.</p><span class="tag">Semaphore v4</span></div>
      <div class="panel step"><div class="tile"><svg viewBox="0 0 24 24"><path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M12 3v7M9 7l3 3 3-3"/></svg></div><h3>Anticipatory trigger</h3><p>Two oracles read GloFAS river forecasts and NOAA rainfall every 6 hours. When both cross the trigger, claims open days before the peak.</p><span class="tag">GloFAS · GEFS · 2-of-2</span></div>
      <div class="panel step"><div class="tile"><svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg></div><h3>Private claim</h3><p>A family proves “I’m enrolled and haven’t claimed” in zero knowledge, even offline. A relayer pays gas yet can’t redirect the money.</p><span class="tag">Groth16 · EIP-3009</span></div>
    </div>
  </div>
</section>

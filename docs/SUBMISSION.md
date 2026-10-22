# DoraHacks BUIDL submission: Naungan

Paste-ready fields for https://dorahacks.io/hackathon/web3-social-good-2026 (deadline 25 Oct 2026, 07:00 SGT).

**Name:** Naungan

**Track:** Tech Track

**Vision (one line):** Cash that reaches families before the flood, heatwave or cyclone, coordinated across aid agencies without any of them sharing who they serve.

**Tags:** Social Impact, Public Good Funding, Decentralized Identity, Privacy, Base, Ethereum, Solidity, Zero-knowledge, Stablecoin

**Links**
- Live app: https://naungan.vercel.app
- Demo video (2 min, captioned): https://naungan.vercel.app/demo.mp4
- Public dashboard: https://naungan.vercel.app/dashboard?program=2
- Demo claim card (one household left unclaimed for judges, claims open until 18 Nov 2026): https://naungan.vercel.app/claim#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D
- Launch a program from a browser wallet: https://naungan.vercel.app/launch
- Open data: https://naungan.vercel.app/api/programs (also GeoJSON, HXL CSV, Atom, IATI 2.03, CAP 1.2; https://naungan.vercel.app/openapi.json)
- Source: https://github.com/PugarHuda/naungan
- Contract (Base Sepolia, Sourcify-verified): https://sepolia.basescan.org/address/0x00E9E8F7a9E8Dd4923Eb92eC5536f70ecD0C70f4
- Relayer health: https://naungan.vercel.app/health

**Description**

Humanitarian cash fails three ways at once: agencies that cannot see each other pay some families twice and miss others; the usual fix pools beneficiary lists in one database that then leaks; and money arrives after the disaster peaks.

Naungan fixes all three in one working system on Base Sepolia with Circle USDC:

1. **Private dedup across agencies.** DDH private set intersection on ristretto255, from the CLI or in the browser by exchanging two files (a request signed by an agency wallet and checked on-chain, and its answer). Tuned for Aceh registers (Teuku/Cut/Haji, bin/binti, pre-1972 spelling, one-letter typos held for review). Each agency learns only which of its own households another agency already serves.
2. **Anonymous enrollment.** Only Semaphore commitments go on-chain. Households with a phone register themselves (`#join=<program>`, from a printable poster), so not even the enrolling agency can recognise their claim; field staff scan the codes with the camera and enroll them from the agency's wallet. Printed QR cards, optionally PIN-locked through a relayer-checked OPRF with 20 tries per card, serve households without phones.
3. **Anticipatory trigger.** Independent oracles post every 6 hours with evidence anyone can recompute in the browser: Copernicus GloFAS river discharge and NOAA GEFS rainfall for floods, NOAA GEFS with ECMWF IFS ENS for heatwaves and cyclone wind. A 2-of-2 quorum opens claims days before the peak. Each program starts from a published Red Cross / Red Crescent Early Action Protocol trigger. Replayed over 30 years, Krueng Aceh's trigger would have paid 7 times, including 23 Nov 2025, and held back 8 rain-only alarms; Tacloban's pays on Haiyan 2013, Beira's on Idai 2019.
4. **Zero-knowledge claim.** The phone builds a Groth16 proof, even offline; if there is no signal the browser sends it when signal returns, even with the app closed. A nullifier blocks double claims; a relayer pays gas but cannot redirect funds. Paid wallets spend USDC at a shop by scanning its QR, with no gas token (EIP-3009). Phones get a payload-free Web Push when claims open. Seven languages, read aloud, amounts in local currency.
5. **Accountability without exposure.** The dashboard is rebuilt from chain events only. "Verify every payout" re-checks every claim's proof from its raw transaction in the visitor's browser, and anyone can sign the result as an EAS attestation. A donor statement page shows any address where its gifts went (paid to households, waiting in the pool, refundable), read from the chain and checked against the contract's own record, printable as proof for a charity's tax receipt. Households rate the aid anonymously with a second Semaphore proof verified by Semaphore's own contract: one rating per enrolled household, unlinkable to its claim.

**Live and global:** 10 programs in 6 countries on 3 continents (Indonesia, Bangladesh, Uganda, Honduras, the Philippines, Mozambique), covering river floods, a heatwave and cyclone wind. Any NGO can launch one from a browser wallet: pick a place, check the trigger on live data and its track record, see the population within 5 km (WorldPop) and IFRC GO's past responses there, then sign. The landing page checks any river worldwide.

**Fits the systems aid already uses:** open data as JSON, GeoJSON, HXL CSV (OCHA HDX), IATI 2.03, CAP 1.2 alerts and an Atom feed (IATI and CAP validated against their official schemas in CI); GDACS alerts on the dashboard; an embeddable status widget for agency sites.

**What makes it different:** other aid-transparency builds make donations visible. Naungan also keeps recipients invisible, deduplicates across agencies without sharing lists, pays before the disaster on an objective, auditable trigger, and lets the people served give feedback that is provably theirs and still anonymous.

**Why Singapore:** Singapore's OHAS pilot (2025–2028) gives a 100% tax deduction for overseas emergency cash through designated charities with strong controls on fund flows; Naungan gives those charities a public ledger and a proof check per payout. Mercy Relief already raised OHAS-deductible funds for the 2025 Sumatra floods.

**Built and tested:** 81 contract and service tests (real Groth16 proofs against the real Semaphore contract, payout audit, PSI, flood/rain/heat/wind trigger math, PIN lockout, gasless spend, relayer verdicts, Web Push), 65 frontend tests, 63 Playwright end-to-end tests on the production build with its real CSP and axe accessibility checks, strict type check, Slither in CI, live oracles on GitHub Actions with a Vercel cron backup, an hourly production monitor, relayer on Vercel with Upstash Redis.

**Team:** Pugar Huda Mantoro (solo).

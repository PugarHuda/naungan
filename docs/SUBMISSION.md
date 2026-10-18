# DoraHacks BUIDL submission: Naungan

Paste-ready fields for https://dorahacks.io/hackathon/web3-social-good-2026 (deadline 25 Oct 2026, 07:00 SGT).

**Name:** Naungan

**Track:** Tech Track

**Vision (one line):** Cash that reaches flood-prone families before the flood, coordinated across aid agencies without any of them sharing who they serve.

**Tags:** Social Impact, Public Good Funding, Decentralized Identity, Privacy, Base, Ethereum, Solidity, Zero-knowledge, Stablecoin

**Links**
- Live app: https://naungan.vercel.app
- Demo video (2 min, captioned): https://naungan.vercel.app/demo.mp4
- Public dashboard: https://naungan.vercel.app/dashboard.html?program=2
- Demo claim card (one household left unclaimed for judges): https://naungan.vercel.app/claim.html#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D
- Source: https://github.com/PugarHuda/naungan
- Contract (Base Sepolia, Sourcify-verified): https://sepolia.basescan.org/address/0xA56D554C9364C332ed361AD01833fA7BAf87c25E
- Relayer health: https://naungan.vercel.app/health

**Description**

Humanitarian cash in Aceh, Indonesia, fails three ways at once: agencies that cannot see each other pay some families twice and miss others; the usual fix pools beneficiary lists in one database that then leaks; and money arrives after the flood peaks.

Naungan fixes all three in one working system on Base Sepolia with Circle USDC:

1. **Private dedup across agencies.** DDH private set intersection on ristretto255, tuned for Aceh registers (titles like Teuku/Cut/Haji, bin/binti, pre-1972 spelling, one-letter typos held for review). Each agency learns only which of its own households another agency already serves.
2. **Anonymous enrollment.** Only Semaphore commitments go on-chain. Households with a phone can register themselves (`#join=<program>`), so not even the enrolling agency can recognise their claim. Printed QR cards, optionally PIN-locked through a relayer-checked OPRF with 20 tries per card, serve households without phones.
3. **Anticipatory trigger.** Two independent oracles (Copernicus GloFAS river discharge and NOAA GEFS rainfall) post every 6 hours with evidence anyone can recompute in the browser. A 2-of-2 quorum opens claims days before the peak. Replayed over 30 years of reanalysis, the trigger would have paid 7 times, including 23 Nov 2025, and held back 8 rain-only alarms.
4. **Zero-knowledge claim.** The phone builds a Groth16 proof, even offline; a nullifier blocks double claims; a relayer pays gas but cannot redirect funds. Paid wallets spend USDC at a shop by scanning its QR, with no gas token (EIP-3009).
5. **Accountability without exposure.** The dashboard is rebuilt from chain events only, and "Verify every payout" re-checks every claim's proof from its raw transaction in the visitor's browser.

**Not only Aceh:** GloFAS and NOAA GEFS are global and the contract takes any coordinates. On the landing page anyone can check any river: Piura, Peru, comes out paying in the 1998 and 2017 El Niño floods. Name matching for dedup has regional profiles (Indonesian/Malay, or basic elsewhere).

**What makes it different:** other aid-transparency builds make donations visible. Naungan also keeps recipients invisible, deduplicates across agencies without sharing lists, and pays before the disaster on an objective, auditable trigger.

**Why Singapore:** Singapore's OHAS pilot (2025–2028) gives a 100% tax deduction for overseas emergency cash through designated charities with strong controls on fund flows; Naungan gives those charities a public ledger and a proof check per payout. Mercy Relief already raised OHAS-deductible funds for the 2025 Sumatra floods.

**Built and tested:** 40 automated tests (contract with real Groth16 proofs, payout audit, PSI, trigger math, PIN lockout, gasless spend), Slither in CI, live oracles on GitHub Actions, relayer on Vercel with Upstash Redis.

**Team:** Pugar Huda Mantoro (solo).

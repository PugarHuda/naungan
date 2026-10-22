# DoraHacks BUIDL submission: Naungan

Paste-ready fields for https://dorahacks.io/hackathon/web3-social-good-2026 (deadline 25 Oct 2026, 07:00 UTC+7, as DoraHacks shows it).

**Name:** Naungan

**Track:** Tech Track

**Vision (one line):** Cash that reaches families before the flood, heatwave or cyclone, coordinated across aid agencies without any of them sharing who they serve.

**Tags:** Social Impact, Public Good Funding, Decentralized Identity, Privacy, Base, Ethereum, Solidity, Zero-knowledge, Stablecoin

**Links**
- Live app: https://naungan.vercel.app
- Demo video (2 min, captioned): https://naungan.vercel.app/demo.mp4
- Try a claim yourself (one household card left unclaimed for judges, open until 18 Nov 2026): https://naungan.vercel.app/claim#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D
- Public dashboard, with running costs: https://naungan.vercel.app/dashboard?program=2
- Donor statement: https://naungan.vercel.app/donor?address=0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E
- Launch a program from a browser wallet: https://naungan.vercel.app/launch
- Open data: https://naungan.vercel.app/api/programs (also GeoJSON, HXL CSV, Atom, IATI 2.03, CAP 1.2; https://naungan.vercel.app/openapi.json)
- Source (MIT): https://github.com/PugarHuda/naungan
- Contract (Base Sepolia, Sourcify-verified): https://sepolia.basescan.org/address/0x00E9E8F7a9E8Dd4923Eb92eC5536f70ecD0C70f4

**Description**

**The problem.** When a flood is coming, aid agencies know days ahead, but the cash usually arrives after the water. When it does arrive, agencies that cannot see each other's lists pay some families twice and miss others. The usual fix is to pool everyone's beneficiary lists in one database, which then leaks the names of the people most at risk.

**What Naungan does, in three sentences.** Agencies register families without sharing their lists, and only an anonymous code goes on the blockchain. When two independent weather forecasts agree a disaster is coming, the contract opens payments automatically, days before the peak. Each family claims from its phone (or a printed card) with a zero-knowledge proof, so it is paid once, nobody can tell who was paid, and anyone can check every payout.

**An example.** In late November 2025, the Krueng Aceh river flooded around Banda Aceh. Replaying the river data, Naungan's trigger would have opened claims by 20 November, three days before the river peaked on the 23rd. Over 30 years of data, the same rule would have paid 7 times, and held back 8 alarms where rainfall crossed its threshold but the river did not reach flood level.

**Three numbers.**
- **10 live programs in 6 countries** (Indonesia, Bangladesh, Uganda, Honduras, the Philippines, Mozambique), for floods, a heatwave and cyclone wind, each using the trigger of a published Red Cross / Red Crescent Early Action Protocol.
- **About half a US cent** for a family's claim on Base mainnet, and about $2.45 a year to run a program with two oracles, measured from the system's own transactions on the public dashboard.
- **0 personal data on-chain**: no names and no ID numbers, nothing that points to a household.

**How it works, in more detail**

1. **Private dedup across agencies.** Agencies compare lists with private set intersection (DDH on ristretto255), from the command line or in the browser by exchanging two files: a request signed by an agency wallet and checked on-chain, and its answer. Name matching is tuned for local registers (Aceh titles such as Teuku, Cut and Haji, bin/binti, old spellings, one-letter typos held for a person to review). Each agency learns only which of its own families another agency already serves.
2. **Anonymous enrollment.** Only Semaphore commitments go on-chain. Families with a phone register themselves from a printed poster, so not even the agency can recognise their claim; field staff scan the codes and enroll them. Printed QR cards, optionally PIN-locked (20 tries, checked by the relayer), serve families without phones.
3. **Anticipatory trigger.** Independent oracles post every 6 hours with evidence anyone can recompute in the browser: Copernicus GloFAS river discharge and NOAA GEFS rainfall for floods, NOAA GEFS with ECMWF ENS for heatwaves and cyclone wind. A 2-of-2 quorum opens claims.
4. **Zero-knowledge claim.** The phone builds a Groth16 proof, even offline, and the browser sends it when signal returns, even with the app closed. A nullifier blocks double claims; the relayer pays gas but cannot redirect the money. Families spend USDC at a shop by scanning its QR, with no gas token (EIP-3009). Seven languages, read aloud, amounts shown in local currency. **"Why this money?"**: an AI model (Claude, through Vercel AI Gateway) explains the trigger to the family in its own language from the program's public on-chain facts, and the answer is shown only if every number in it appears in those facts; nothing about the family is ever sent to the model.
5. **Accountability without exposure.**
   - **Payouts:** "Verify every payout" re-checks every claim's proof in the visitor's browser, and anyone can sign the result as an EAS attestation.
   - **Donors:** a donor statement shows any address where its gifts went (paid to households, waiting in the pool, or refundable), checked against the contract's own record.
   - **Families:** they rate the aid anonymously with a second Semaphore proof, one rating per family, which can't be linked to its payment.

**Fits the systems aid already uses:** open data as JSON, GeoJSON, HXL CSV (OCHA HDX), IATI 2.03, CAP 1.2 alerts and an Atom feed (IATI and CAP validated against their official schemas in CI); GDACS disaster alerts and IFRC GO responses on the dashboard; an embeddable status widget for agency sites.

**What makes it different:** other aid-transparency builds make donations visible. Naungan also keeps recipients invisible, deduplicates across agencies without sharing lists, pays before the disaster on an objective trigger anyone can audit, and lets the people served give feedback that is provably theirs and still anonymous.

**Feasibility and sustainability**

- **It keeps running without us.** The contract has no owner, no upgrade and no pause switch, so a program pays out even if this project disappears. Anyone can send a claim straight to the contract, so our relayer is a convenience, not a gatekeeper. Oracles and the relayer are plain Node scripts any agency can run with its own keys, and the contract works on any EVM chain with any ERC-20 token.
- **It costs almost nothing to run.** The dashboard's Running costs panel prices the system's own transactions on Base mainnet on every visit: mainnet gas price, Base's L1 data fee, and ETH/USD from Chainlink. On 22 Oct 2026, a claim cost about $0.005 and enrolling a family about $0.003. A program with two oracles costs about $2.45 a year in reports, and enrolling and paying 1,000 families about $8.40 more: about 1% of the aid at 1 USD a family, and 0.02% at 50 USD a family. Hosting runs on free tiers (Vercel, GitHub Actions, Upstash).
- **Who pays:** the coordinating agency funds the relayer's and oracles' gas from the program budget, as it already pays for delivering cash today. Donors fund the pool directly, and the contract returns their unused share after the season; the coordinator never holds the money.
- **Compliance stays where it belongs.** Identity checks (KYC, sanctions screening) are done by the enrolling agency, off-chain, under its existing duties; the chain only learns that a family is enrolled, not who it is. This follows the data-minimisation principle of the ICRC Handbook on Data Protection in Humanitarian Action.
- **Cash-out.** Today a family pays a shop by QR in USDC with no fees. In a real deployment, the agency would pair Naungan with local agents or licensed exchanges that convert USDC to local money, as mobile-money programs use agents now.
- **An open public good.** Naungan is MIT-licensed, and `docs/DPG.md` assesses it against the nine indicators of the Digital Public Goods Standard, gaps included, ahead of applying to the DPG registry.
- **Who will use it:** the Red Cross / Red Crescent national societies whose Early Action Protocols the programs already follow, and charities that raise funds for overseas disasters. Singapore's OHAS pilot (2025–2028) gives a 100% tax deduction for overseas emergency cash through designated charities with strong controls on fund flows: Naungan gives those charities a public ledger, a proof check per payout and a donor statement. Mercy Relief already raised OHAS-deductible funds for the 2025 Sumatra floods.

**Honest limits**
- **Testnet only:** all funds are Circle testnet USDC (23.65 USDC, 5 payouts so far), and there is no NGO partner or field pilot yet.
- **One operator for now:** the two oracles read independent data (Copernicus and NOAA / ECMWF), but both keys are run by this project until an agency runs one.
- **A trigger is not a forecast-skill score:** the 30-year replay shows what the rule would have done with perfect forecasts, not how often the forecasts are right.
- **Not reviewed yet:** no legal review for any country, and the translations still need native speakers.

**Built and tested:** 85 contract and service tests (real Groth16 proofs against the real Semaphore contract, payout audit, PSI, flood/rain/heat/wind trigger math, PIN lockout, gasless spend, relayer verdicts, Web Push), 68 frontend tests, 65 Playwright end-to-end tests on the production build with its real security headers and axe accessibility checks, strict type check, Slither in CI, live oracles on GitHub Actions with a Vercel cron backup, an hourly production monitor.

**Team:** Pugar Huda Mantoro (solo).

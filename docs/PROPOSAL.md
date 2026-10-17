# Naungan
### Privacy-preserving, anticipatory cash coordination for humanitarian agencies

*Naungan* (Indonesian: "shelter") lets several aid agencies deduplicate, deliver and prove cash assistance **without ever sharing who their beneficiaries are**.

**Track:** Tech Track (working prototype included) · **Pilot context:** Rohingya refugees and flood-prone communities in Aceh, Indonesia

---

## 1. The social challenge (Social impact & problem relevance — 30%)

Cash assistance is now a core part of humanitarian response (about 21% of international humanitarian assistance in 2022, up from 10% in 2016, per CALP via Mercy Corps). When several agencies serve the same crisis, three problems show up together:

**a. Duplication and gaps between agencies.** The same household can be paid twice while another is missed. The need is proven and costly. In Ukraine, 18 organisations used WFP's Building Blocks between May and August 2022 to coordinate about USD 337M of assistance, and they prevented about **USD 35M of overlap**. That was enough to reach about 185,000 more people for three months (WFP; OECD OPSI).

**b. Today's fix creates a new danger: concentrating beneficiary data.** The usual setup is a single registry run by a host organisation. Agencies are reluctant to hand their lists to a party with more power over the data (IFRC / DIGID data-sharing study). Recent research concludes that current deduplication approaches *"risk privacy harm to vulnerable aid recipients"* (xDup, 2026). These are not hypothetical harms. Breaches include the ICRC in 2022 (more than 515,000 highly vulnerable people) and WFP Gaza in 2026 (about 600,000 households with names, ID numbers and locations), as reported by Aleo. Migrants and refugees avoid registering for aid when exposure could mean detention or deportation.

**c. Public blockchains make privacy worse, not better.** On a public chain an aid payment becomes a permanent record of who received what and where. One write-up calls it *"a map that leads straight to the most vulnerable people."* Full anonymity is not an answer either, because agencies must still meet donor reporting, AML/CTF and sanctions rules.

**d. Aid arrives after the suffering peaks.** Humanitarian funding is reactive. Mercy Corps' blockchain-based anticipatory pilot in Kenya released USDT to 262 pastoralists from climate-data triggers. Transaction costs fell from 10% to 2.5%, settlement went from 14.5 hours to near-instant, and 77% of participants reported lower financial stress.

**Why Aceh.** Indonesia hosts more than 12,700 refugees and asylum-seekers, and 3,770 Rohingya have landed in Aceh since 2023 (UNHCR). Indonesia is not party to the 1951 Refugee Convention, so data exposure is especially dangerous for them. Several actors serve them at once (UN agencies, NGOs, zakat institutions), and the same districts face recurring floods.

## 2. Intended users and beneficiaries

| Who | What they need | What Naungan gives them |
|---|---|---|
| **Households** (refugees, flood-affected families) | Timely help, safety, dignity, no exposure | A QR claim card they hold themselves, a phone claim in their language with no crypto skills, unlinkable payouts, money *before* the flood peaks |
| **Aid agencies / zakat institutions** | Avoid double-paying without handing over their lists | Private set intersection: each learns only "already served?" for its own records |
| **Donors** | Proof that money reached unique, eligible people | A public, verifiable dashboard with zero personal data |
| **Auditors / regulators** | Compliance and traceability | Every trigger with its data evidence, every enrollment batch by agency, and every payout on a public ledger; agencies keep their own records under their existing audit |

## 3. The solution (Solution quality — 25%)

```
 Agency A list ─┐   signed, on-chain-authorised          ┌─► Public dashboard (aggregates + oracle evidence)
                ├─ L1 Private dedup (PSI over HTTP) ─► L2 Anonymous enrollment + QR claim cards
 Agency B list ─┘   nobody sees other lists                 (Semaphore commitments only)
                                                     │
        L3 Flood oracle: 51-member GloFAS ensemble vs the river's 1-in-5-year flood → % on-chain + evidence
                                                     │
        Household scans its card → phone builds a ZK proof "I am an enrolled, unclaimed member"
        → gas relayer submits (no ETH, no seed phrase) → Circle USDC to a fresh wallet on the phone → spent gaslessly (EIP-3009) at a cash-out agent or shop
```

1. **L1 – Private cross-agency dedup.** Agencies run DDH private set intersection over normalised biographic keys with phonetic matching, so *Fatima/Fatimah* and *Muhammad/Mohammed* still match while two different men named Abdul Karim stay separate. Agency A learns only which of *its* households B already serves; B learns only set sizes. The dedup service answers **only agencies registered on-chain for the program**: every query is signed, time-boxed and checked against `isAgency()`, which closes the membership-probing attack an open PSI endpoint would allow.
2. **L2 – Anonymous enrollment.** Each surviving household gets a Semaphore identity printed as a QR claim card (with a typed fallback code). Agencies enroll only the identity commitment. A coordinator can revoke a compromised agency at any time.
3. **L3 – Anticipatory trigger on the Red Cross's own data.** The oracle reads the GloFAS v4 river-discharge forecast (Copernicus, via Open-Meteo), fits a Gumbel distribution to 29 years of reanalysis to get the 1-in-5-year flood level for that river cell, and posts the share of the ensemble members that exceed it. Claims open only when an M-of-N quorum of independent oracle operators agree within 24 hours, and the oracle runs unattended every 6 hours on GitHub Actions. This mirrors IFRC Early Action Protocols such as Uganda Red Cross (act at ≥60–70% probability of a 5-year flood). The full computation is written on-chain as an evidence string that anyone can re-derive. Real check: for Krueng Aceh, GloFAS reanalysis peaks at **1,116 m³/s on 23 Nov 2025**, above the 963 m³/s 5-year level, in the floods that left 904,000 people displaced in Aceh.
4. **L4 – Private claim, public accountability.** The household's phone generates the Groth16 proof locally, even with no signal (the app, proving keys and group are cached, and the claim is sent automatically when signal returns), (the secret never leaves the device and is stripped from the URL). The proof binds the payout address, so the relayer pays gas but cannot redirect funds, and a per-program nullifier enforces one claim per household. The chain records only commitments, nullifiers and totals. Unclaimed funds return after the claim window, or after the season ends without a flood, so donor money is never locked.

**Design principles:** no host organisation, no raw data sharing, no crypto skills needed by households, never block a trigger on paperwork, each program's pool isolated from every other's, and the claim app in the household's language (English and Bahasa Indonesia).

## 4. Why Web3 is meaningful here (Innovation & meaningful use of Web3 — 20%)

- **Neutral shared state between parties who do not trust each other.** That is exactly why WFP built Building Blocks on a blockchain. Naungan removes the remaining trust problem: no agency operates the registry, and no agency sees another's data.
- **Global one-claim-per-household rule without identity.** Nullifiers make double claims impossible and publicly checkable while revealing nothing about who claimed.
- **Programmable, pre-committed money.** Donors fund a pool that releases only on an objective trigger and only to proven-eligible members, and it refunds automatically.
- **Verifiable accountability with zero personal data.** Anyone can recompute "N unique households paid, X disbursed" from chain events.
- **Why not a database?** A database needs an operator that every agency trusts with its beneficiary list, which is the very concentration of power and data that the sector is trying to avoid.

## 5. What is built today (verifiable)

| Component | What it does | Status |
|---|---|---|
| `contracts/Naungan.sol` | Programs with on-chain hazard metadata, M-of-N oracle quorum, agency add/remove, anonymous enrollment, oracle trigger with evidence, ZK claim with relayer-safe payout, own nullifier set (front-running safe), per-program pools, season end and refunds | ✅ 15 contract tests; Slither: 0 medium/high |
| `lib/psi.js` + `scripts/agency.js` | DDH-PSI over ristretto255, served over HTTP to signed, on-chain-registered agencies only; enrollment and QR claim cards | ✅ Tested, attack-tested (unsigned, non-agency, replayed queries rejected) |
| `lib/hazard.js` + `scripts/oracle.js` | Live GloFAS ensemble probability, Gumbel return levels, labelled replay of past events | ✅ Live data, tested |
| `scripts/relayer.js` | Validates and simulates each claim before paying gas; sponsors gasless USDC spends (EIP-3009, Circle-native) for payout wallets only; nonce-safe queue; rate limit | ✅ Tested end-to-end |
| `web/claim.html` | Household app (installable PWA): in-browser Groth16 proof, works offline and sends the claim when signal returns, EN/ID | ✅ Browser-tested: claim, offline claim, double claim, underfunded, unenrolled card; axe-core WCAG 2.1 AA: 0 violations |
| `web/dashboard.html`, `web/index.html` | Public totals, oracle evidence and CSV/JSON audit export from chain events only | ✅ XSS- and CSV-injection-tested; WCAG 2.1 AA: 0 violations |
| CI, Pages, hosted oracle | Tests, build and a Slither gate on every push; web apps on GitHub Pages; the GloFAS oracle runs every 6 hours on GitHub Actions | ✅ |

## 6. Feasibility & long-term sustainability (15%)

**Precedent:** UNHCR already pays displaced Ukrainians in Circle USDC on Stellar, cashed out at MoneyGram; Mercy Corps ran anticipatory smart-contract payouts in Kenya; WFP Building Blocks deduplicated USD 337M across 18 organisations; IFRC National Societies trigger early action on GloFAS. Naungan combines these and adds privacy.

**Pilot:** one Aceh district on the Krueng Aceh cell, an NGO plus a zakat institution, around 200 households. Measured on duplicates avoided, cost per dollar delivered, time from trigger to cash, and enrollment hesitancy.

**Sustainability:** open source (MIT) so any agency can self-host every service. A small per-program coordination fee inside the program budget, never on top of a donation, covers relayer gas and oracle runs. Measured with the Hardhat gas reporter: a ZK claim costs ~337k gas, enrolling a household ~100k, an oracle report ~83k. At Base mainnet gas of 0.006 gwei and ETH at $2,431 (17 Oct 2026) that is about **$0.005 of execution per claim**, so delivering $50 costs under 0.1% in gas, versus 5–15% fees for legacy transfers. Governance is a consortium of the participating agencies.

**Risks and mitigations**
| Risk | Mitigation in the code today |
|---|---|
| Phonetic matching misses variants or over-merges | Two independent keys with birth year as a guard; agencies review flagged matches before enrolling |
| Small groups weaken anonymity | One group per program across all agencies; the relayer decouples who submits from who is paid |
| Oracle manipulation | M-of-N quorum of independent oracle keys with a 24-hour freshness window, so no single key can trigger; every report carries an evidence string re-derivable from the public GloFAS API; it can only release *pre-committed* funds to *pre-enrolled* households |
| Compromised agency | `removeAgency`, and the dedup service rejects it immediately |
| Funds stuck if no flood | `seasonEnd`: the pool is refundable after the season |
| No signal during the flood | The claim app works offline: proving keys and the group are cached, and the proof is queued and sent when signal returns |
| Off-ramp / liquidity | Circle USDC, the same asset UNHCR distributes and MoneyGram cashes out |

## 7. Team & ask
**Pugar Huda Mantoro** (solo builder): contracts, ZK integration, PSI service, flood oracle, relayer, web apps. Code: [github.com/PugarHuda/naungan](https://github.com/PugarHuda/naungan).

I am seeking mentorship and introductions to one NGO and one zakat or humanitarian partner for a co-designed pilot. As the Blockchain for Good community puts it, most such projects fail because *"the founder understood the technology better than the problem"*, so I want to build this **with** the agencies and communities, not for them.

---
**Sources:** IFRC Early Action Protocols (Uganda Red Cross floods EAP2021UG01, Kenya MDRKE053, Pakistan EAP2025PK02); Open-Meteo Global Flood API (GloFAS v4); Circle USDC contract addresses; UNHCR × Stellar Ukraine pilot (Dec 2022); Indonesia Humanitarian Coordination Platform Situation Report 1, Aceh floods (ReliefWeb, 2 Dec 2025); Katadata/BNPB, 904.1k Acehnese displaced (8 Dec 2025); WFP Building Blocks Ukraine report; OECD OPSI; Ukraine CWG data-management assessment (2025); xDup, arXiv 2604.08019; IFRC data-sharing in cash assistance; Mercy Corps *Digital Cash Series: Cryptocurrencies & Cash Assistance*; Aleo, *The Case for Private Stablecoin Payments in Humanitarian Aid*; UNHCR Indonesia country page and April 2025 statistical report.

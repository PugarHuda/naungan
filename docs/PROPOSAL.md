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
| **Households** (refugees, flood-affected families) | Timely help, safety, dignity, no exposure | A credential they hold themselves, unlinkable payouts, money *before* the flood peaks |
| **Aid agencies / zakat institutions** | Avoid double-paying without handing over their lists | Private set intersection: each learns only "already served?" for its own records |
| **Donors** | Proof that money reached unique, eligible people | A public, verifiable dashboard with zero personal data |
| **Auditors / regulators** | Compliance and traceability | Selective disclosure (view keys, roadmap) instead of all-or-nothing |

## 3. The solution (Solution quality — 25%)

```
 Agency A list ─┐                                      ┌─► Public dashboard (aggregates only)
                ├─ L1 Private dedup (PSI) ─► L2 Anonymous enrollment ─┤
 Agency B list ─┘   nobody sees other lists   (Semaphore commitments) └─► Auditor view keys (roadmap)
                                                     │
                     L3 Hazard oracle (forecast rainfall ≥ threshold) opens the claim window
                                                     │
                     Household proves "I am an enrolled, unclaimed member" in zero knowledge
                     → relayer submits (no gas, no seed phrase) → stablecoin to a fresh address
                     → local merchant / off-ramp
```

1. **L1 – Private cross-agency dedup.** Agencies run a DDH-based private set intersection over normalised biographic keys, with phonetic matching so *Fatima/Fatimah* and *Muhammad/Mohammed* still match. Agency A learns which of *its* households agency B already serves. B learns only set sizes. No list, name or brute-forceable hash ever leaves an agency.
2. **L2 – Anonymous enrollment.** Each surviving household gets a Semaphore identity, held in a chat-bot wallet or printed as a QR card. Agencies enroll only the identity commitment into a shared program group on-chain.
3. **L3 – Anticipatory trigger.** An oracle posts a hazard index, for example a forecast rainfall feed. When it crosses the program threshold, the claim window opens before the disaster peaks.
4. **L4 – Private claim, public accountability.** A household proves group membership in zero knowledge. The proof binds the payout address, so a relayer can pay gas but cannot redirect funds. A per-program nullifier enforces one claim per household. The chain records only commitments, nullifiers and aggregate counters. Unclaimed funds return to the coordinator after the window closes.

**Design principles:** no host organisation, no raw data sharing, no crypto skills needed by households, never block a trigger on paperwork (an early partial payout beats a late full one), and each program's pool is isolated from every other's.

## 4. Why Web3 is meaningful here (Innovation & meaningful use of Web3 — 20%)

- **Neutral shared state between parties who do not trust each other.** That is exactly why WFP built Building Blocks on a blockchain. Naungan removes the remaining trust problem: no agency operates the registry, and no agency sees another's data.
- **Global one-claim-per-household rule without identity.** Nullifiers make double claims impossible and publicly checkable while revealing nothing about who claimed.
- **Programmable, pre-committed money.** Donors fund a pool that releases only on an objective trigger and only to proven-eligible members, and it refunds automatically.
- **Verifiable accountability with zero personal data.** Anyone can recompute "N unique households paid, X disbursed" from chain events.
- **Why not a database?** A database needs an operator that every agency trusts with its beneficiary list, which is the very concentration of power and data that the sector is trying to avoid.

## 5. What is built today (verifiable)

| Component | Status |
|---|---|
| `contracts/Naungan.sol`: programs, agency allow-list, anonymous enrollment, oracle trigger, ZK claim with relayer-safe payout binding, own nullifier set (front-running safe), per-program pool isolation, refund | ✅ Built, tested |
| `lib/psi.js`: DDH-PSI over ristretto255 with name normalisation + phonetic keys | ✅ Built, tested |
| Real Groth16 Semaphore v4 proofs verified on-chain | ✅ In tests and demo |
| `scripts/demo.js`: full Aceh scenario, two agencies, one duplicate caught privately, a same-name/different-person correctly *not* merged, flood trigger, 5 anonymous claims, double-claim rejected, public dashboard from events | ✅ Runs locally |
| 11 automated tests (`npm test`) | ✅ Passing |
| Base Sepolia deployment: [Naungan](https://sepolia.basescan.org/address/0x1794e29cc18Ea6832b3Da8A48623c3c4ec603E34) · [Semaphore](https://sepolia.basescan.org/address/0x7F1fFc96160467Af072bc9a0E9DC246739AcdBdA) · [Mock USDC](https://sepolia.basescan.org/address/0x083507f71Ab6E0aBCDDF6A0BaAb012F3212Ab04b) | ✅ Live; Aceh demo executed on-chain (5 ZK claims, 250 USDC, double-claim rejected) |

## 6. Feasibility & long-term sustainability (15%)

**Precedent:** stablecoin cash delivery (Mercy Corps: under 10 minutes and under 1% fees vs 5–15% legacy), anticipatory smart-contract triggers (Mercy Corps Kenya), and blockchain deduplication at scale (WFP Building Blocks). Naungan combines all three and adds privacy.

**Roadmap**
1. **Refinement:** fuzzy PSI for typo-level variants (following xDup), W3C Verifiable Credentials with selective disclosure, a Telegram/WhatsApp bot wallet (the Mercy Corps "Project Lydian" pattern), and offline QR vouchers for feature phones.
2. **Compliance layer:** auditor view keys, a ZK proof of non-membership in sanctions lists, and AI anomaly detection on *aggregate* flows only.
3. **Chain:** EVM today. We are evaluating Aptos (Keyless accounts for onboarding, BN254 pairing support for Groth16 verification).
4. **Pilot:** one district, two partners (an NGO plus a zakat institution), around 200 households. Measured on duplicates avoided, cost per dollar delivered, time-to-cash vs the current method, and enrollment hesitancy.

**Sustainability:** open-source (MIT) so any agency can self-host. A small per-program coordination fee, inside the program budget and never on top of a donation, covers relayer gas and oracle costs. Governance is a consortium of participating agencies acting as a neutral data steward.

**Risks and mitigations**
| Risk | Mitigation |
|---|---|
| Phonetic matching misses variants or over-merges | Two independent keys, birth year as a guard, fuzzy PSI on the roadmap, and human review for borderline cases |
| Small groups weaken anonymity | Pool many programs/districts into larger groups and use relayers so payout timing is decoupled |
| Oracle manipulation | Multi-source forecasts and multisig oracle; the trigger can only release *pre-committed* funds to *pre-enrolled* households |
| Off-ramp / liquidity | Merchant QR redemption and local ramps; the stablecoin is one modality among several |
| Regulation | Selective disclosure keeps auditors and regulators in the loop. Built for compliance, not to evade it. |

## 7. Team & ask
**Pugar Huda Mantoro** (solo builder): contracts, ZK integration, PSI, dashboard. Code: [github.com/PugarHuda/naungan](https://github.com/PugarHuda/naungan).

I am seeking mentorship and introductions to one NGO and one zakat or humanitarian partner for a co-designed pilot. As the Blockchain for Good community puts it, most such projects fail because *"the founder understood the technology better than the problem"*, so I want to build this **with** the agencies and communities, not for them.

---
**Sources:** WFP Building Blocks Ukraine report; OECD OPSI; Ukraine CWG data-management assessment (2025); xDup, arXiv 2604.08019; IFRC data-sharing in cash assistance; Mercy Corps *Digital Cash Series: Cryptocurrencies & Cash Assistance*; Aleo, *The Case for Private Stablecoin Payments in Humanitarian Aid*; UNHCR Indonesia country page and April 2025 statistical report.

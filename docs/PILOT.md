# Running a Naungan pilot

What one agency needs to run Naungan for real in one district for one season: who does what, in what order, what it costs, what must be settled with a regulator first, and how to tell whether it worked. Every figure below is measured from the live deployment or cited.

## Who does what

| Role | Who | Holds | Does |
|---|---|---|---|
| Coordinator | The lead agency (for example a Red Cross or Red Crescent national society, or a charity designated under Singapore's OHAS) | A wallet that creates the program | Picks the trigger from its Early Action Protocol, names the oracles and agencies, publishes the program |
| Enrolling agencies | The coordinator and its partners | Their own beneficiary lists, off-chain, and an agency wallet | Identify households (KYC, sanctions screening) under their existing duties, dedup with each other without sharing lists (`/dedup` or `scripts/agency.js`), enroll anonymous commitments |
| Oracles | At least two keys run by different organisations, for example the coordinator and a university or meteorological partner | One key each | Each runs `node scripts/oracle.js --all` on its own machine or CI; a 2-of-2 quorum means neither can open claims alone |
| Donors | Anyone, including the coordinator's own funders | USDC | Fund the pool on the dashboard; take back their unpaid share after the season; get a donor statement (`/donor`) |
| Relayer | The coordinator (or anyone: `claim()` accepts a proof from any sender) | A key with a little ETH for gas | Runs `scripts/relayer.js` or the Vercel function so households never need ETH |
| Cash-out agents | Shops or licensed exchange agents near the households | A wallet | Accept USDC by QR (gasless, EIP-3009) and pay out local money |

## Timeline for one season

| Week | Step | Done when |
|---|---|---|
| 1–2 | Choose the place and trigger on `/launch`: start from the national society's Early Action Protocol preset, check the replayed track record (a trigger that never pays, or pays more than one year in three, is flagged) and IFRC GO's past responses there | The coordinator signs off the trigger and the amount |
| 1–3 | Legal and data review (below), in parallel | The checklist below is complete |
| 3 | Deploy on Base mainnet: `npx hardhat run scripts/deploy.js --network base`, then `node scripts/verify.js` (Sourcify). The same flow is rehearsed with Circle's real USDC on a fork of Base by `MAINNET_FORK=1 npx hardhat test test/mainnet-fork.test.js` | `web/deployment.json` names the mainnet contract |
| 3 | Create the program from the coordinator's wallet on `/launch`; add the partner agencies | The program shows on `/dashboard` |
| 3 | Start both oracles (`.github/workflows/oracle.yml` with each organisation's key, or their own machines) | Both readings appear on the dashboard every 6 hours |
| 4–6 | Enrollment: print the registration poster (`/poster?program=N`) for households with phones; field staff scan their codes on `/enroll`; PIN-locked QR cards for households without phones (`scripts/agency.js enroll --pin`); dedup between agencies first | Enrolled count matches the agencies' lists after dedup |
| 4–6 | Fund the pool to `households × amount` (the dashboard shows any shortfall, the open data carries it) | Shortfall is 0 |
| 4–6 | Recruit cash-out agents near the households and test one small spend | One test spend settled |
| Season | Watch: the hourly production monitor opens a GitHub issue when anything fails (oracle silent for 13 h, relayer low on gas, AI explanation down) | No open monitor issue |
| Trigger | Claims open automatically; households get a push alert and claim from the claim app; agencies tell households without phones | Payouts land within minutes of the trigger |
| After | Donors take back unpaid money; agencies read the anonymous ratings; the open data (IATI, HXL CSV) goes into the agency's own reporting | Report written |

## What it costs

Gas, priced live on the dashboard's **Running costs** panel from this deployment's own transactions (22 Oct 2026, Base mainnet gas price and Chainlink ETH/USD):

| Item | Cost |
|---|---|
| One household's claim (proof verified on-chain, USDC paid) | about $0.005 |
| Enrolling one household | about $0.003 |
| One oracle report | about $0.0008; two oracles, four reports a day for a year: about $2.45 |
| 1,000 households enrolled and paid | about $8.40 |
| AI explanation for households (Claude Haiku 5.5) | about $0.0002 an answer, at most about $0.05 a day (300-call cap) |
| Hosting (Vercel, GitHub Actions, Upstash) | free tiers |

At 50 USD a household, delivery and oracles together are about 0.02% of the aid paid. The real costs of a pilot are people: field staff for enrollment, and the legal review.

## Settle before the first payout

- **Data protection:** a data protection impact assessment following the ICRC Handbook on Data Protection in Humanitarian Action. Naungan stores no personal data on-chain (commitments, nullifiers, payout addresses only), and names never leave an agency in dedup; the agencies' own lists stay under their existing controls.
- **KYC, AML and sanctions:** the enrolling agency identifies and screens households before enrolling them, as it does for cash programs today. Agree with the regulator how payouts to self-custodied wallets are treated, and the limits per household.
- **Cash-out:** a licensed partner (exchange, mobile-money agent, or remittance company) that converts USDC to local money near the households, and its fees.
- **USDC:** Circle can freeze an address under court order; the program's money sits in the Naungan contract until claimed.
- **Grievances:** households can rate the aid anonymously from the claim app (one proven rating each); agree who reads the ratings and how a household reaches a person.
- **Trigger ownership:** the national society signs off the trigger it already uses in its Early Action Protocol; Naungan only automates it.

## How to tell whether it worked

| Measure | Where it comes from |
|---|---|
| Share of enrolled households paid before the forecast peak | `Claimed` events against the oracle's evidence (peak date), on the dashboard and in the IATI export |
| Time from trigger to payout | Block times of `IndexReported` and each `Claimed` |
| Duplicates found between agencies | The dedup run's counts (`/dedup`), off-chain |
| Every payout verified | "Verify every payout" on the dashboard, and EAS attestations by independent auditors |
| Households' rating of the aid | "What households say" on the dashboard |
| Cost per household | The Running costs panel |

The evidence base for paying before a flood: in July 2020, households along the Jamuna that WFP paid days before the peak were 36% less likely to go a day without eating during the flood ([Pople, Hill, Dercon and Brunckhorst, 2021](https://www.anticipation-hub.org/download/file-3482); published as [The Importance of Being Early?](https://ora.ox.ac.uk/objects/uuid:ca0b464e-9c4d-4aab-9553-1124b4f79747/files/rmg74qp83d)). Naungan's program #5 watches the same gauge with the same forecast model.

## Exit

Nothing locks an agency in. The contract has no owner and no upgrade: a program pays out or refunds on its own rules even if this project stops. All data is open (JSON, IATI, HXL, CAP), and the code is MIT-licensed.

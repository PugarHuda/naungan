# Naungan

Privacy-preserving, anticipatory humanitarian cash. Agencies deduplicate their beneficiary lists without sharing them (private set intersection), enroll households as anonymous Semaphore commitments, a flood oracle opens claims when the **GloFAS** river forecast (the same model IFRC Early Action Protocols trigger on) crosses a return-period threshold, and households claim once from their phone with a zero-knowledge proof. Donors verify every total on-chain, with zero personal data there. Full pitch: [docs/PROPOSAL.md](docs/PROPOSAL.md).

**Try it live (Base Sepolia, Circle testnet USDC):** [landing](https://naungan.vercel.app/) · [public dashboard](https://naungan.vercel.app/dashboard.html?program=2) · gas relayer [naungan.vercel.app/health](https://naungan.vercel.app/health). One enrolled household card is left unclaimed for reviewers: [open the demo card](https://naungan.vercel.app/claim.html#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D) on a phone, tap Claim, and 1 USDC lands in a wallet created on the phone, about 12 s end to end. First come, first served: a second claim is rejected by design.

```bash
npm install
npm test        # 34 tests: contract (real Groth16 proofs), PSI, GloFAS and rainfall trigger math, gasless EIP-3009 spend, PIN-locked cards, service input validation
npm run demo    # Aceh scenario in-process: live GloFAS reading, then a replay of the real Nov 2025 flood
```

## Components

| Path | What it does |
|---|---|
| `contracts/Naungan.sol` | Programs with on-chain hazard metadata, M-of-N oracle quorum (24 h freshness), agency allow-list (add/remove), anonymous enrollment, oracle trigger with evidence string, ZK claim with relayer-safe payout binding, per-program pools, season end + refunds |
| `lib/psi.js` | DDH private set intersection over ristretto255 with name normalisation and phonetic keys |
| `lib/hazard.js` | Two independent trigger pipelines via Open-Meteo: GloFAS v4 river discharge (Gumbel 1-in-T-year flood from reanalysis, ensemble exceedance) and NOAA GEFS rainfall averaged over the catchment against an ERA5 rainfall climatology; replay of past events for both |
| `scripts/verify.js` | Source verification on Sourcify (API v2) |
| `scripts/coordinator.js` | Create a program, add/remove agencies, fund (USDC), refund, status |
| `scripts/agency.js` | `serve`: answer dedup queries, only from agencies registered on-chain (signed, fresh requests). `enroll`: dedup against peers over HTTP, enroll the rest, print QR claim cards; `--pin` locks each card with a 6-digit PIN on a separate slip (AES-256-GCM under PBKDF2-SHA256, 600k iterations, `lib/cardlock.js`), so a lost or photographed card cannot be claimed |
| `scripts/oracle.js` | Post the trigger for a program; each oracle runs the pipeline its address is assigned in the program metadata (`--watch` hours, `--replay` date, `--dry-run`, `--source`) |
| `scripts/relayer.js` | Gas relayer: validates proof shape, simulates the claim, then submits; also sponsors EIP-3009 `transferWithAuthorization` so a paid household can send USDC to a cash-out agent without ever holding ETH (only for Naungan payout wallets); nonce-safe queue, rate limit |
| `web/index.html` | Landing page: live counters and the newest program's GloFAS 30-day forecast against its flood threshold, plus its **track record**: the exact trigger replayed over every day of the reanalysis in the browser (GloFAS since 1997 and ERA5 rain; for Krueng Aceh the 2-of-2 quorum would have paid 7 times, including 23 Nov 2025, and held back 8 rain-only alarms) |
| `web/dashboard.html` | Public dashboard rebuilt from chain events, each oracle's reading and evidence, **Re-check in my browser** (re-runs the oracle's own `lib/hazard.js` against Open-Meteo and compares value and full evidence with the chain), per-program view, **fund a program from any browser wallet** (EIP-6963 discovery, switches to Base Sepolia, approve + fund, faucet link when short), per-program **track record** (same replay, on demand), CSV/JSON audit export |
| `web/claim.html` + `web/sw.js` | Household claim app (EN / Bahasa Indonesia, installable PWA): reads the QR card, proves membership in the browser, works offline and sends the queued claim when signal returns; **flood alerts with no push server**: an installed app polls the program in the background (Periodic Background Sync) and raises a local notification when claims open, so no server or push service ever learns which phones belong to beneficiaries |
| `.github/workflows` | CI (tests, build, Slither gate), GitHub Pages, and the hosted oracle running every 6 hours |

## Run the whole system locally

```bash
npx hardhat node                                                  # terminal 1
npx hardhat run scripts/deploy.js --network localhost             # writes web/deployment.json
npm run serve                                                     # terminal 2 → http://localhost:5173
node scripts/relayer.js                                           # terminal 3 → http://localhost:8788

node scripts/coordinator.js create --name "Krueng Aceh flood · Banda Aceh" --lat 5.55 --lon 95.32 \
     --return-period 5 --lead-days 10 --trigger 60 --amount 50 --claim-days 14 --season-days 180
node scripts/coordinator.js add-agency --program 1 --agency <agency address>
node scripts/coordinator.js mint --amount 1000 && node scripts/coordinator.js fund --program 1 --amount 250

# agency B (its own PRIVATE_KEY) answers dedup; agency A dedups against it and prints cards
node scripts/agency.js serve  --program 1 --list data/unhcr.csv --port 7001
node scripts/agency.js enroll --program 1 --list data/zakat.csv --peer http://localhost:7001 \
     --claim-url http://localhost:5173/claim.html --cards cards/zakat.html

node scripts/oracle.js --program 1                       # today's real GloFAS forecast
node scripts/oracle.js --program 1 --replay 2025-11-20   # replay the real 23 Nov 2025 Krueng Aceh flood
node scripts/oracle.js --program 4 --source rain --replay 2025-11-20 --dry-run   # the rain pipeline on the same event
```

Open a card's QR (or paste its code at `/claim.html`) and claim. The services read `PRIVATE_KEY` from `.env` (gitignored, never committed); on a local node that wallet is given dev ETH automatically.

## Base Sepolia

```bash
PRIVATE_KEY=<funded key> npx hardhat run scripts/topup.js --network baseSepolia   # gas for the .env service wallet
npx hardhat run scripts/deploy.js --network baseSepolia                          # Circle testnet USDC, not a mock
node scripts/verify.js                                                           # Sourcify API v2, no API key
```

Live deployment: Naungan [`0xA56D554C9364C332ed361AD01833fA7BAf87c25E`](https://sepolia.basescan.org/address/0xA56D554C9364C332ed361AD01833fA7BAf87c25E) ([Sourcify exact match](https://repo.sourcify.dev/84532/0xA56D554C9364C332ed361AD01833fA7BAf87c25E)), Semaphore `0x647787568ADf29dBA55Dbc068C618ECF575b420F`. Program #1 has real claims and a gasless spend on its ledger. The relayer runs on Vercel (`api/relayer.js`, same core as `node scripts/relayer.js`; `vercel env add PRIVATE_KEY` then `vercel deploy --prod`); `RELAYER_URL` at deploy time points the claim app at it.

Funding uses Circle's official testnet USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`); get some at [faucet.circle.com](https://faucet.circle.com). `MockUSDC` exists only for the local dev chain, where Circle has no contract.

## What is real, and its limits

- **Trigger data** is live GloFAS v4 from Copernicus via Open-Meteo. A `--replay` report is labelled `REPLAY` in its on-chain evidence and never presented as a forecast.
- **Oracle trust** is an M-of-N quorum of keys chosen by the coordinator; each report is re-derivable from the public API and its on-chain evidence string. Program 4 runs live as **2-of-2 with two independent forecasts**: one key posts GloFAS (Copernicus/ECMWF river model), another posts NOAA GEFS rainfall averaged over five cells of the Krueng Aceh catchment. Both post from the hosted workflow every 6 hours, and the dashboard shows each oracle's reading, age and evidence.
- **Why the rain oracle uses a 1-in-2-year threshold and a catchment average:** replaying the real Nov 2025 flood, rainfall at the river-mouth cell was 240 mm against a 318 mm 1-in-5-year 10-day total, so a point gauge at 1-in-5 would have blocked the trigger while the river flooded. The catchment mean was 262 mm against a 229 mm 1-in-2-year total: the rain signal confirms GloFAS instead of vetoing it. ERA5 underestimates convective tropical rain, so a stricter rain threshold would miss real events.
- **Track record** replays the trigger over reanalysis, i.e. what a *perfect* forecast would have fired on. It shows how often a program would pay and that the quorum filters rain-only alarms; it does not measure forecast skill, and it is not checked against recorded impacts (GDACS lists only province-level Aceh floods and misses Nov 2025 near Banda Aceh, so it is too coarse to score hits).
- **Dedup** is semi-honest DDH-PSI over exact and phonetic keys, tuned for Aceh registers: Fatima/Fatimah, Muhammad/Mohammed, titles (Teuku/T., Teungku/Tgk, Cut, Haji/H.) and bin/binti, and pre-1972 spelling (Oemar/Umar, Djamal/Jamal, Jusuf/Yusuf) all match. A birth year one off, or a one-letter typo Soundex misses (Dewi/Devi, Mulyadi/Muryadi, via SymSpell-style deletion keys), is a possible match: it is held back in `<list>.review.csv` for a person to confirm, never auto-merged, because namesakes in one village are also a year apart. Two typos in one word still miss; the typo keys make a dedup run ~15x larger (about 30 s for 200 against 200 households on a laptop). Claim cards and PIN slips print in Indonesian with English below.
- **PIN cards** stop casual theft, photo copies and guessing on the phone (each try costs ~3 s). They do not stop an attacker who has the card and a GPU: a 6-digit PIN falls to an offline search in about a minute. Attempt-limited PIN checks would need a server-side OPRF, which this build does not have.
- **Event history** for the dashboard and relayer comes from the Blockscout indexer (`deployment.json.indexer`), falling back to 200-block RPC windows when it is unreachable.
- **The relayer** must be reachable from the household's phone; `deployment.json.relayer` points the claim app at it.

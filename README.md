# Naungan

Privacy-preserving, anticipatory humanitarian cash. Agencies deduplicate their beneficiary lists without sharing them (private set intersection), enroll households as anonymous Semaphore commitments, a flood oracle opens claims when the **GloFAS** river forecast (the same model IFRC Early Action Protocols trigger on) crosses a return-period threshold, and households claim once from their phone with a zero-knowledge proof. Donors verify every total on-chain, with zero personal data there. Full pitch: [docs/PROPOSAL.md](docs/PROPOSAL.md).

```bash
npm install
npm test        # 26 tests: contract (real Groth16 proofs), PSI, GloFAS trigger math, gasless EIP-3009 spend, service input validation
npm run demo    # Aceh scenario in-process: live GloFAS reading, then a replay of the real Nov 2025 flood
```

## Components

| Path | What it does |
|---|---|
| `contracts/Naungan.sol` | Programs with on-chain hazard metadata, M-of-N oracle quorum (24 h freshness), agency allow-list (add/remove), anonymous enrollment, oracle trigger with evidence string, ZK claim with relayer-safe payout binding, per-program pools, season end + refunds |
| `lib/psi.js` | DDH private set intersection over ristretto255 with name normalisation and phonetic keys |
| `lib/hazard.js` | GloFAS v4 (via Open-Meteo): Gumbel 1-in-T-year flood from reanalysis, ensemble exceedance probability, replay of past events |
| `scripts/verify.js` | Source verification on Sourcify (API v2) |
| `scripts/coordinator.js` | Create a program, add/remove agencies, fund (USDC), refund, status |
| `scripts/agency.js` | `serve`: answer dedup queries, only from agencies registered on-chain (signed, fresh requests). `enroll`: dedup against peers over HTTP, enroll the rest, print QR claim cards |
| `scripts/oracle.js` | Post the GloFAS trigger for a program (`--watch` hours, `--replay` date, `--dry-run`) |
| `scripts/relayer.js` | Gas relayer: validates proof shape, simulates the claim, then submits; also sponsors EIP-3009 `transferWithAuthorization` so a paid household can send USDC to a cash-out agent without ever holding ETH (only for Naungan payout wallets); nonce-safe queue, rate limit |
| `web/index.html` | Landing page with live counters |
| `web/dashboard.html` | Public dashboard rebuilt from chain events, oracle evidence, per-program view, CSV/JSON audit export |
| `web/claim.html` + `web/sw.js` | Household claim app (EN / Bahasa Indonesia, installable PWA): reads the QR card, proves membership in the browser, works offline and sends the queued claim when signal returns |
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
```

Open a card's QR (or paste its code at `/claim.html`) and claim. The services read `PRIVATE_KEY` from `.env` (gitignored, never committed); on a local node that wallet is given dev ETH automatically.

## Base Sepolia

```bash
PRIVATE_KEY=<funded key> npx hardhat run scripts/topup.js --network baseSepolia   # gas for the .env service wallet
npx hardhat run scripts/deploy.js --network baseSepolia                          # Circle testnet USDC, not a mock
node scripts/verify.js                                                           # Sourcify API v2, no API key
```

Live deployment: Naungan [`0xA56D554C9364C332ed361AD01833fA7BAf87c25E`](https://sepolia.basescan.org/address/0xA56D554C9364C332ed361AD01833fA7BAf87c25E) ([Sourcify exact match](https://repo.sourcify.dev/84532/0xA56D554C9364C332ed361AD01833fA7BAf87c25E)), Semaphore `0x647787568ADf29dBA55Dbc068C618ECF575b420F`. Program #1 has real claims and a gasless spend on its ledger. The claim app needs a relayer the phone can reach: run `node scripts/relayer.js` and set `RELAYER_URL` before deploying.

Funding uses Circle's official testnet USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`); get some at [faucet.circle.com](https://faucet.circle.com). `MockUSDC` exists only for the local dev chain, where Circle has no contract.

## What is real, and its limits

- **Trigger data** is live GloFAS v4 from Copernicus via Open-Meteo. A `--replay` report is labelled `REPLAY` in its on-chain evidence and never presented as a forecast.
- **Oracle trust** is an M-of-N quorum of keys chosen by the coordinator; each report is re-derivable from the public API and its on-chain evidence string.
- **Dedup** is semi-honest DDH-PSI over exact and phonetic keys: Fatima/Fatimah and Muhammad/Mohammed match, typo-level variants beyond Soundex do not.
- **The relayer** must be reachable from the household's phone; `deployment.json.relayer` points the claim app at it.

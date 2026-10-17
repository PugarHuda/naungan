# Naungan

Privacy-preserving, anticipatory humanitarian cash. Agencies deduplicate their beneficiary lists without sharing them (private set intersection), enroll households as anonymous Semaphore commitments, a flood oracle opens claims when the **GloFAS** river forecast (the same model IFRC Early Action Protocols trigger on) crosses a return-period threshold, and households claim once from their phone with a zero-knowledge proof. Donors verify every total on-chain, with zero personal data there. Full pitch: [docs/PROPOSAL.md](docs/PROPOSAL.md).

```bash
npm install
npm test        # 22 tests: contract (real Groth16 proofs), PSI, GloFAS trigger math, service input validation
npm run demo    # Aceh scenario in-process: live GloFAS reading, then a replay of the real Nov 2025 flood
```

## Components

| Path | What it does |
|---|---|
| `contracts/Naungan.sol` | Programs with on-chain hazard metadata, agency allow-list (add/remove), anonymous enrollment, oracle trigger with evidence string, ZK claim with relayer-safe payout binding, per-program pools, season end + refunds |
| `lib/psi.js` | DDH private set intersection over ristretto255 with name normalisation and phonetic keys |
| `lib/hazard.js` | GloFAS v4 (via Open-Meteo): Gumbel 1-in-T-year flood from reanalysis, ensemble exceedance probability, replay of past events |
| `scripts/coordinator.js` | Create a program, add/remove agencies, fund (USDC), refund, status |
| `scripts/agency.js` | `serve`: answer dedup queries, only from agencies registered on-chain (signed, fresh requests). `enroll`: dedup against peers over HTTP, enroll the rest, print QR claim cards |
| `scripts/oracle.js` | Post the GloFAS trigger for a program (`--watch` hours, `--replay` date, `--dry-run`) |
| `scripts/relayer.js` | Gas relayer: validates proof shape, simulates the claim, then submits; nonce-safe queue, rate limit |
| `web/index.html` | Landing page with live counters |
| `web/dashboard.html` | Public dashboard rebuilt from chain events, oracle evidence, per-program view |
| `web/claim.html` | Household claim app (EN / Bahasa Indonesia): reads the QR card, proves membership in the browser, claims via the relayer |

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
npx hardhat verify --network baseSepolia <naungan> <semaphore> <usdc>             # Sourcify, no API key
```

Funding uses Circle's official testnet USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`); get some at [faucet.circle.com](https://faucet.circle.com). `MockUSDC` exists only for the local dev chain, where Circle has no contract.

## What is real, and its limits

- **Trigger data** is live GloFAS v4 from Copernicus via Open-Meteo. A `--replay` report is labelled `REPLAY` in its on-chain evidence and never presented as a forecast.
- **One oracle key per program.** Anyone can re-derive the value from the public API and the evidence string, but the contract trusts the oracle address the coordinator chose.
- **Dedup** is semi-honest DDH-PSI over exact and phonetic keys: Fatima/Fatimah and Muhammad/Mohammed match, typo-level variants beyond Soundex do not.
- **The relayer** must be reachable from the household's phone; `deployment.json.relayer` points the claim app at it.

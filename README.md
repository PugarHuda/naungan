# Naungan

Privacy-preserving, anticipatory humanitarian cash. Agencies dedup privately (PSI), enroll households as anonymous Semaphore commitments, a hazard oracle opens claims before a disaster peaks, and households claim once with a ZK proof. The full pitch is in [docs/PROPOSAL.md](docs/PROPOSAL.md).

```bash
npm install
npm test        # 11 tests: contract (real Groth16 proofs) + PSI
npm run demo    # Aceh end-to-end scenario + public dashboard
```

**Live dashboard** (3 terminals):
```bash
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost && node scripts/serve.js   # → http://localhost:5173
STEP_DELAY=3000 npx hardhat run scripts/demo.js --network localhost              # watch it fill in
```

**Base Sepolia:** put `PRIVATE_KEY=0x...` in `.env` (gitignored, loaded automatically), then `npx hardhat run scripts/deploy.js --network baseSepolia`, then run the demo with `--network baseSepolia` (with one key, every role uses that key). The dashboard links each event to Basescan.

| Path | What |
|---|---|
| `contracts/Naungan.sol` | Programs, agencies, enrollment, oracle trigger, ZK claim, refund |
| `lib/psi.js` | DDH-PSI over ristretto255 with phonetic matching |
| `scripts/demo.js` | Pitch demo (in-process, or against a deployed network) |
| `scripts/deploy.js` | Deploy + write `web/deployment.json` |
| `web/index.html` | Public dashboard, chain events only |

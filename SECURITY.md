# Security policy

Naungan moves money to households who may be at risk if they can be identified, so privacy bugs count as security bugs.

## Reporting

Report privately through [GitHub security advisories](https://github.com/PugarHuda/naungan/security/advisories/new), not in a public issue. English or Indonesian is fine. Expect an answer within 7 days.

## In scope

- `contracts/Naungan.sol`: anything that pays a household twice, pays the wrong address, lets an oracle or agency move pooled funds, or blocks donor refunds.
- The relayer (`scripts/relayer.js`, `/relay`, `/transfer`, `/pin`, `/subscribe`, `/notify`): spending its gas on transactions it should refuse, bypassing the PIN try limit, or making it send requests to hosts other than browser push services.
- The claim app (`claim`): anything that leaks a card's identity secret, links a payout to a household, or lets a page or an API answer read secrets from another origin.
- The open-data endpoints (`/api/programs`, `/feed.xml`, `/cap.xml`, `/programs.csv`, `/programs.geojson`): anything that exposes who was paid.

## Out of scope

- The deployment is on Base Sepolia, a testnet. Testnet funds have no value, but report the bug anyway: the same code would run on mainnet.
- Rate limits of the free public services we read (Open-Meteo, Blockscout, the public RPC).

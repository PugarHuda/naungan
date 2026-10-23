// Hypercerts (hypercerts.org): an on-chain, divisible claim to a piece of impact, the standard retroactive funders
// (Optimism RetroPGF, Gitcoin, Hypercerts' own marketplace) read and trade. A program's payouts become one hypercert
// whose 100,000,000 units are all the USDC that reached households, split among the donors who paid for it exactly
// as the contract's refund() splits a pool: pro rata to each gift. Donors mint their own fraction from an allowlist
// (OpenZeppelin Merkle tree, the leaf HypercertMinter checks), so nobody but the donor ever holds it.
// Used by scripts/hypercert.js (mint) and the donor statement (claim), so both compute the same tree.
import { StandardMerkleTree } from "@openzeppelin/merkle-tree"

/** HypercertMinter (UUPS proxy) from @hypercerts-org/contracts' deployments. */
export const MINTER = { 84532: "0xC2d179166bc9dbB00A03686a5b17eCe2224c2704" }
/** Hypercerts' own API and app for test networks: metadata and allowlist go to IPFS through it, as their SDK does. */
export const API = { 84532: "https://staging-api-v2.hypercerts.org" }
export const APP = { 84532: "https://testnet.hypercerts.org" }

export const ABI = [
    "event ClaimStored(uint256 indexed claimID, string uri, uint256 totalUnits)",
    "function createAllowlist(address account, uint256 units, bytes32 merkleRoot, string _uri, uint8 restrictions)",
    "function mintClaimFromAllowlist(address account, bytes32[] proof, uint256 claimID, uint256 units)",
    "function isAllowedToClaim(bytes32[] proof, uint256 claimID, bytes32 leaf) view returns (bool)",
    "function hasBeenClaimed(uint256, bytes32) view returns (bool)",
    "function uri(uint256 tokenID) view returns (string)"
]
export const ALLOW_ALL = 0 // TransferRestrictions.AllowAll: a donor may gift or sell the fraction to a retro funder

/** Hypercerts' convention (their API refuses anything else): a hypercert has exactly 100,000,000 units. */
export const UNITS = 100_000_000n

/**
 * Each donor's fraction of the payouts, from every gift up to the snapshot. gifts: [{ donor, amount }] (bigint);
 * pool: { funded, claims, amountPerHousehold } at the same block. A donor who gave a quarter of the pool paid for a
 * quarter of its claims (refund() splits it the same way), so units = UNITS × gave / funded, largest remainder first
 * so they add up to UNITS exactly; `paid` is that share in USDC base units, floored like refund().
 */
export function shares(gifts, pool) {
    const given = new Map()
    for (const g of gifts) given.set(g.donor.toLowerCase(), (given.get(g.donor.toLowerCase()) ?? 0n) + g.amount)
    const total = [...given.values()].reduce((s, v) => s + v, 0n)
    if (total !== pool.funded || total === 0n) throw new Error(`gifts add up to ${total}, the contract says ${pool.funded}: wrong snapshot`)
    const paid = pool.claims * pool.amountPerHousehold
    const rows = [...given].map(([address, gave]) => ({ address, units: (gave * UNITS) / total, rest: (gave * UNITS) % total, paid: (gave * paid) / total }))
    let left = UNITS - rows.reduce((s, r) => s + r.units, 0n)
    for (const r of [...rows].sort((a, b) => (b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : a.address < b.address ? -1 : 1))) {
        if (left === 0n) break
        r.units++
        left--
    }
    return rows.filter((r) => r.units > 0n).map(({ address, units, paid }) => ({ address, units, paid })).sort((a, b) => (a.address < b.address ? -1 : 1))
}

export const tree = (entries) => StandardMerkleTree.of(entries.map((e) => [e.address, e.units.toString()]), ["address", "uint256"])

/** The donor's entry and proof in a tree dump, or null when the address holds no units. */
export function proofOf(dump, address) {
    const t = StandardMerkleTree.load(typeof dump === "string" ? JSON.parse(dump) : dump)
    for (const [i, [a, units]] of t.entries()) {
        if (a.toLowerCase() === address.toLowerCase()) return { units: BigInt(units), proof: t.getProof(i), leaf: t.leafHash([a, units]) }
    }
    return null
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const usdc = (u) => (Number(u) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })

/** A 4:5 card, inline as a data URI, so the image needs no host of its own. */
export function image({ name, households, paid, from, to, exercise }) {
    const lines = [name.slice(0, 34), name.slice(34, 68)].filter(Boolean)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800">
<rect width="640" height="800" fill="#0b3d2a"/><rect x="24" y="24" width="592" height="752" rx="28" fill="none" stroke="#57d18f" stroke-width="2"/>
<text x="56" y="104" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#57d18f">NAUNGAN</text>
<text x="56" y="140" font-family="Arial,sans-serif" font-size="20" fill="#cfe9dc">Cash before the disaster</text>
${lines.map((l, i) => `<text x="56" y="${250 + i * 44}" font-family="Arial,sans-serif" font-size="36" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join("")}
<text x="56" y="440" font-family="Arial,sans-serif" font-size="96" font-weight="700" fill="#ffffff">${households}</text>
<text x="56" y="484" font-family="Arial,sans-serif" font-size="26" fill="#cfe9dc">households paid · ${usdc(paid)} USDC</text>
<text x="56" y="560" font-family="Arial,sans-serif" font-size="22" fill="#cfe9dc">${day(from)} → ${day(to)}</text>
<text x="56" y="600" font-family="Arial,sans-serif" font-size="22" fill="#cfe9dc">Each paid once, by zero-knowledge proof</text>
${exercise ? `<text x="56" y="720" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#ffcf5a">TESTNET EXERCISE · REPLAYED TRIGGER</text>` : ""}
</svg>`
    return "data:image/svg+xml;base64," + (typeof Buffer !== "undefined" ? Buffer.from(svg).toString("base64") : btoa(unescape(encodeURIComponent(svg))))
}

/**
 * Hypercert metadata (the SDK's formatHypercertData shape, schema/metadata.json) for one program's payouts so far.
 * p: { programId, name, hazard, evidence, households, paid (USDC base units), from (trigger time), to (last claim), deadline,
 *      donors, contract, chainId, block, base (site origin), exercise }
 */
export function metadata(p) {
    const range = (n, a, b) => ({ name: n, value: [a, b], display_value: `${day(a)} → ${day(b)}` })
    const list = (n, v) => ({ name: n, value: v, excludes: [], display_value: v.join(", ") })
    const scope = [`${p.hazard} anticipatory cash`, p.name]
    return {
        name: `${p.name}: ${p.households} households paid`,
        description: [
            `Naungan program #${p.programId} paid ${p.households} enrolled households ${usdc(p.paid)} USDC in total after ${p.exercise ? "a replayed" : "a"} forecast trigger, each household once, by a Semaphore zero-knowledge proof, so nobody can tell which household was paid.`,
            `The 100,000,000 units stand for all of it, as of block ${p.block}; each donor's fraction is their share of the pool, pro rata to their gifts, as the contract's refund() splits it.`,
            `Trigger evidence posted on-chain: ${p.evidence}`,
            p.exercise ? "This is a testnet exercise on Base Sepolia with test USDC: the trigger replays a past flood from reanalysis (the evidence above); it is not a live forecast and the claims are demonstration claims." : "",
            `Verify every figure at ${p.base}/dashboard?program=${p.programId} (contract ${p.contract} on chain ${p.chainId}).`
        ].filter(Boolean).join("\n\n"),
        external_url: `${p.base}/dashboard?program=${p.programId}`,
        image: image(p),
        version: "2.0",
        properties: [
            { trait_type: "program", value: String(p.programId) },
            { trait_type: "contract", value: `${p.chainId}:${p.contract}` },
            { trait_type: "snapshot block", value: String(p.block) },
            { trait_type: "status", value: p.exercise ? "testnet exercise" : "live" }
        ],
        hypercert: {
            impact_scope: list("Impact Scope", ["all"]),
            work_scope: list("Work Scope", scope),
            impact_timeframe: range("Impact Timeframe", p.from, p.deadline),
            work_timeframe: range("Work Timeframe", p.from, p.to),
            rights: list("Rights", ["Public Display"]),
            contributors: list("Contributors", p.donors)
        }
    }
}

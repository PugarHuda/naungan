// Hypercerts (hypercerts.org): an on-chain, divisible claim to a piece of impact, the standard retroactive funders
// (Optimism RetroPGF, Gitcoin, Hypercerts' own marketplace) read and trade. A program's payouts become one hypercert
// whose 100,000,000 units are all the USDC that reached households, split among the donors who paid for it exactly
// as the contract's refund() splits a pool: pro rata to each gift. Donors mint their own fraction from an allowlist
// (OpenZeppelin Merkle tree, the leaf HypercertMinter checks), so nobody but the donor ever holds it.
// Used by scripts/hypercert.js (mint) and the donor statement (claim), so both compute the same tree.
import { StandardMerkleTree } from "@openzeppelin/merkle-tree"
import { AbiCoder, ZeroAddress, ZeroHash, getAddress, solidityPackedKeccak256 } from "ethers"
import { EAS_ABI } from "./eas.mjs"

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
export const loadTree = (dump) => StandardMerkleTree.load(typeof dump === "string" ? JSON.parse(dump) : dump)

/** The donor's entry and proof in a tree dump, or null when the address holds no units. */
export function proofOf(dump, address) {
    const t = loadTree(dump)
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

// Evaluations: Hypercerts' own EAS schema (hypercerts-app configs/eas.ts), registered on Base Sepolia, which their app
// reads to mark a hypercert verified (all of basic, work and contributors = 1) or disputed (all = 2). 0 = not checked.
export const EVAL_SCHEMA = "uint256 chain_id,address contract_address,uint256 token_id,uint8 evaluate_basic,uint8 evaluate_work,uint8 evaluate_contributors,uint8 evaluate_properties,string comments,string[] tags"
const EVAL_FIELDS = ["uint256", "address", "uint256", "uint8", "uint8", "uint8", "uint8", "string", "string[]"]
export const EVAL_UID = solidityPackedKeccak256(["string", "address", "bool"], [EVAL_SCHEMA, ZeroAddress, true])
const VALID = 1, INVALID = 2
const coder = AbiCoder.defaultAbiCoder()

export async function sha256(text) {
    const b = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
}

/**
 * Re-checks one minted hypercert against the chain, the way Hypercerts' evaluation form asks:
 *   basic        the metadata states the households and USDC the contract paid by the snapshot block
 *   work         every payout up to that block passes the independent ZK audit (lib/audit.mjs results)
 *   contributors the allowlist is exactly the donors' pro-rata shares, recomputed from Funded events
 *   properties   the files are the ones hashed at mint, and name this contract and block
 * entry: a web/hypercerts.json row; metaText/listText: the served files; gifts: [{ donor, amount, block }] (every
 * Funded of the program); payouts: [{ block, ok }] (every Claimed with its audit verdict). Returns 1/2 per field.
 */
export async function evaluate({ entry, metaText, listText, gifts, payouts }) {
    const why = []
    const fail = (field, text) => (why.push(`${field}: ${text}`), INVALID)
    let meta = null, list = null
    try { meta = JSON.parse(metaText); list = loadTree(listText) } catch { /* judged below */ }
    const hashed = (await sha256(metaText)) === entry.sha256 && (await sha256(listText)) === entry.allowListSha256
    const prop = (k) => meta?.properties?.find((p) => p.trait_type === k)?.value
    const properties = !hashed ? fail("properties", "the files differ from the ones hashed at mint")
        : prop("contract") !== `${entry.chainId}:${entry.contract}` || prop("snapshot block") !== String(entry.block) ? fail("properties", "the metadata names another contract or block") : VALID

    const paid = `${(Number(entry.paid) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` // as metadata() writes it
    const basic = !meta ? fail("basic", "metadata unreadable")
        : !meta.name?.includes(`${entry.claims} households paid`) || !meta.description?.includes(`${entry.claims} enrolled households`) || !meta.external_url?.endsWith(`program=${entry.programId}`) ? fail("basic", `the metadata does not state ${entry.claims} households of program #${entry.programId}`)
        : !meta.description.includes(paid) ? fail("basic", `the metadata does not state ${paid} paid`) : VALID

    const upTo = payouts.filter((p) => p.block <= entry.block)
    const work = upTo.length !== entry.claims ? fail("work", `${upTo.length} payouts up to block ${entry.block}, the certificate claims ${entry.claims}`)
        : upTo.some((p) => !p.ok) ? fail("work", `${upTo.filter((p) => !p.ok).length} payout(s) fail the zero-knowledge audit`) : VALID

    let contributors
    try {
        const before = gifts.filter((g) => g.block <= entry.block)
        const funded = before.reduce((t, g) => t + g.amount, 0n)
        const expect = tree(shares(before, { funded, claims: BigInt(entry.claims), amountPerHousehold: BigInt(entry.paid) / BigInt(entry.claims) }))
        contributors = !list || list.root !== expect.root || expect.root !== entry.root ? fail("contributors", "the allowlist is not the donors' pro-rata shares at the snapshot")
            : JSON.stringify(meta?.hypercert?.contributors?.value?.map((a) => a.toLowerCase()).sort()) !== JSON.stringify([...expect.entries()].map(([, [a]]) => a.toLowerCase()).sort()) ? fail("contributors", "the contributors listed are not the allowlisted donors") : VALID
    } catch (e) {
        contributors = fail("contributors", e.message)
    }
    return { basic, work, contributors, properties, why }
}

/** The comment an evaluation carries: what was checked, in a sentence, then each failure. */
export const evaluationComment = (entry, v, auditors) => [
    v.why.length ? `Naungan certificate check found problems with program #${entry.programId}'s hypercert.` : `Re-checked against the chain: ${entry.claims} payouts of Naungan program #${entry.programId} up to block ${entry.block}, each zero-knowledge proof verified again by the evaluator from its raw transaction; the allowlist recomputed from the Funded events; metadata and allowlist match the sha256 recorded at mint.`,
    ...v.why,
    auditors ? `Payout audits on EAS for this program: ${auditors}.` : ""
].filter(Boolean).join(" ")

/** EAS attest() calldata for an evaluation of `entry` under Hypercerts' schema (recipient none, as their app does). */
export function evaluationCall(entry, v, comment, tags = ["naungan", "zk-payout-audit"]) {
    const data = coder.encode(EVAL_FIELDS, [entry.chainId, getAddress(entry.minter), BigInt(entry.claimID), v.basic, v.work, v.contributors, v.properties, comment, tags])
    return EAS_ABI.encodeFunctionData("attest", [{ schema: EVAL_UID, data: { recipient: ZeroAddress, expirationTime: 0n, revocable: true, refUID: ZeroHash, data, value: 0n } }])
}

/**
 * Every Hypercerts evaluation of one certificate from the EAS indexer, newest first. The query is scoped to this token
 * (easscan's decoded JSON holds it as an even-length BigNumber hex; the closing quote keeps a longer id out) and read
 * page by page, so other certificates' evaluations can never push this one's out of a window. Each is still decoded
 * and checked here; malformed ones are dropped.
 */
export async function listEvaluations({ graphql, entry }) {
    const query = `query($s: String!, $t: String!, $skip: Int!) { attestations(where: { schemaId: { equals: $s }, revoked: { equals: false }, decodedDataJson: { contains: $t } }, orderBy: [{ time: desc }], take: 100, skip: $skip) { id attester time data } }`
    let hex = BigInt(entry.claimID).toString(16)
    if (hex.length % 2) hex = "0" + hex
    const out = []
    for (let skip = 0; ; skip += 100) {
        const res = await fetch(graphql, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { s: EVAL_UID, t: `"hex":"0x${hex}"}`, skip } }), signal: AbortSignal.timeout(20000) })
        if (!res.ok) throw new Error(`EAS indexer answered ${res.status}`)
        const j = await res.json()
        if (j.errors?.length) throw new Error(`EAS indexer: ${j.errors[0].message}`)
        for (const a of j.data.attestations) {
            let x
            try { x = coder.decode(EVAL_FIELDS, a.data) } catch { continue }
            if (Number(x[0]) !== entry.chainId || x[1].toLowerCase() !== entry.minter.toLowerCase() || x[2].toString() !== entry.claimID) continue
            const [basic, work, contributors, properties] = [x[3], x[4], x[5], x[6]].map(Number)
            out.push({ uid: a.id, attester: getAddress(a.attester), time: Number(a.time), basic, work, contributors, properties, comment: x[7], verified: basic === VALID && work === VALID && contributors === VALID, disputed: basic === INVALID && work === INVALID && contributors === INVALID })
        }
        if (j.data.attestations.length < 100 || skip >= 5000) break // ponytail: 50 pages is far beyond any real certificate
    }
    return out
}

/** One evaluation per address (its newest), as Naungan's payout audits are counted: a key that signs twice counts once. */
export const latestPerAttester = (evals) => [...new Map([...evals].sort((a, b) => a.time - b.time).map((e) => [e.attester.toLowerCase(), e])).values()].sort((a, b) => b.time - a.time)

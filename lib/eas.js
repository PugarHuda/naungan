// Independent payout audits, signed on the Ethereum Attestation Service (EAS). Anyone who re-verifies a
// program's payouts (lib/audit.js, in the dashboard or `node scripts/eas.js audit`) can publish the result
// under their own address: "at block B, V of C payouts verified against the group with root R". Donors then
// see how many unrelated parties checked the money, not just our word, and each claim stays anonymous.
// EAS is a predeploy on Base (and OP chains); its GraphQL indexer (easscan) is keyless and CORS-open.
// The dashboard (browser bundle), the CLI and the tests run this same file.
const { AbiCoder, Interface, ZeroHash, getAddress, solidityPackedKeccak256, ZeroAddress } = require("ethers")

const SCHEMA = "string app,uint256 programId,uint256 claims,uint256 verified,uint256 members,uint256 groupRoot,uint64 atBlock"
const FIELDS = ["string", "uint256", "uint256", "uint256", "uint256", "uint256", "uint64"]
const APP = "naungan-payout-audit-v1"
const REVOCABLE = true // an auditor who finds a mistake in their own run can withdraw it
const EAS_ABI = new Interface([
    "function attest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data)) payable returns (bytes32)",
    "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)"
])
const REGISTRY_ABI = new Interface([
    "function register(string schema, address resolver, bool revocable) returns (bytes32)",
    "function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))"
])

/** The schema's UID, as SchemaRegistry computes it: keccak256(schema ‖ resolver ‖ revocable). */
const schemaUid = () => solidityPackedKeccak256(["string", "address", "bool"], [SCHEMA, ZeroAddress, REVOCABLE])

const coder = AbiCoder.defaultAbiCoder()
function encodeAudit({ programId, claims, verified, members, groupRoot, atBlock }) {
    return coder.encode(FIELDS, [APP, programId, claims, verified, members, groupRoot, atBlock])
}
function decodeAudit(data) {
    const [app, programId, claims, verified, members, groupRoot, atBlock] = coder.decode(FIELDS, data)
    if (app !== APP) throw new Error(`not a Naungan audit (${app})`)
    return { programId, claims: Number(claims), verified: Number(verified), members: Number(members), groupRoot, atBlock: Number(atBlock) }
}

/**
 * The attest() call for one audit result. The recipient is the Naungan contract, so all audits of one
 * deployment are one indexed query; the program id is inside the data.
 */
function attestCall(naungan, audit) {
    return EAS_ABI.encodeFunctionData("attest", [{ schema: schemaUid(), data: { recipient: getAddress(naungan), expirationTime: 0n, revocable: REVOCABLE, refUID: ZeroHash, data: encodeAudit(audit), value: 0n } }])
}
/** UID of the attestation a receipt created. */
function attestedUid(receipt) {
    for (const l of receipt.logs) {
        try {
            const p = EAS_ABI.parseLog(l)
            if (p?.name === "Attested") return p.args.uid
        } catch {}
    }
    return null
}

/**
 * Every unrevoked audit of `programId` on this deployment, newest first, from the EAS indexer. Malformed
 * attestations under the same schema (anyone can write one) are dropped, never shown as audits.
 */
async function listAudits({ graphql, naungan, programId }) {
    const query = `query($s: String!, $r: String!) { attestations(where: { schemaId: { equals: $s }, recipient: { equals: $r }, revoked: { equals: false } }, orderBy: [{ time: desc }], take: 200) { id attester time txid data } }`
    const res = await fetch(graphql, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { s: schemaUid(), r: getAddress(naungan) } }), signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`EAS indexer answered ${res.status}`)
    const j = await res.json()
    if (j.errors?.length) throw new Error(`EAS indexer: ${j.errors[0].message}`)
    const out = []
    for (const a of j.data.attestations) {
        let v
        try { v = decodeAudit(a.data) } catch { continue }
        if (BigInt(v.programId) !== BigInt(programId) || v.verified > v.claims) continue
        out.push({ uid: a.id, attester: getAddress(a.attester), time: Number(a.time), txid: a.txid, ...v, programId: BigInt(v.programId) })
    }
    return out
}

/** Distinct auditors whose latest attestation for the program found every payout valid, at the newest claim count they saw. */
function summarise(audits) {
    const latest = new Map()
    for (const a of audits) if (!latest.has(a.attester) || latest.get(a.attester).atBlock < a.atBlock) latest.set(a.attester, a)
    const list = [...latest.values()]
    return { auditors: list.length, clean: list.filter((a) => a.verified === a.claims).length, flagged: list.filter((a) => a.verified < a.claims).length, latest: list }
}

module.exports = { SCHEMA, APP, REVOCABLE, EAS_ABI, REGISTRY_ABI, schemaUid, encodeAudit, decodeAudit, attestCall, attestedUid, listAudits, summarise }

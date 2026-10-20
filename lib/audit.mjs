// Independent payout audit: re-verify every claim's zero-knowledge proof from the raw transaction,
// without trusting the contract, the relayer or this site. Anyone can run it; nobody learns who claimed.
// The dashboard (browser bundle) and the tests (Node) run this same file.
import { Group, verifyProof } from "@semaphore-protocol/core"
import { Interface } from "ethers"

const CLAIM = new Interface([
    "function claim(uint256 programId, (uint256 merkleTreeDepth, uint256 merkleTreeRoot, uint256 nullifier, uint256 message, uint256 scope, uint256[8] points) proof)"
])

/**
 * @param programId  the program being audited
 * @param members    its group leaves in insertion order (Naungan.members); enroll() is closed once the
 *                   trigger fires and claims only open after it, so every valid claim proves membership
 *                   of exactly this final tree
 * @param claims     [{ nullifier, payout, tx: { hash, to, data } }] from the Claimed events and their txs
 * @param contract   the Naungan address the txs must call
 * @returns [{ hash, ok, checks: { name: true|false|null } }]; null means the check could not be run
 *          (e.g. a claim submitted through another contract, so its calldata is not a direct call)
 */
/** Merkle root of the group rebuilt from its leaves in insertion order; null for an empty group. */
const groupRoot = (members) => (members.length ? new Group(members.map(BigInt)).root : null)

async function auditClaims({ programId, members, claims, contract }) {
    const root = groupRoot(members)
    const seen = new Map()
    for (const c of claims) seen.set(String(c.nullifier), (seen.get(String(c.nullifier)) ?? 0) + 1)
    const out = []
    for (const c of claims) {
        const checks = { direct: false, scope: null, payout: null, nullifier: null, root: null, proof: null, unique: seen.get(String(c.nullifier)) === 1 }
        let parsed = null
        try {
            if (c.tx.to?.toLowerCase() === contract.toLowerCase()) parsed = CLAIM.parseTransaction({ data: c.tx.data })
        } catch {}
        if (parsed?.name === "claim") {
            checks.direct = true
            const [pid, p] = parsed.args
            const proof = { merkleTreeDepth: Number(p.merkleTreeDepth), merkleTreeRoot: String(p.merkleTreeRoot), nullifier: String(p.nullifier), message: String(p.message), scope: String(p.scope), points: p.points.map(String) }
            checks.scope = BigInt(pid) === BigInt(programId) && BigInt(proof.scope) === BigInt(programId)
            checks.payout = BigInt(proof.message) === BigInt(c.payout)
            checks.nullifier = BigInt(proof.nullifier) === BigInt(c.nullifier)
            checks.root = root !== null && BigInt(proof.merkleTreeRoot) === root
            try {
                checks.proof = await verifyProof(proof)
            } catch {
                checks.proof = false // malformed points or an unsupported depth
            }
        }
        out.push({ hash: c.tx.hash, ok: Object.values(checks).every((v) => v === true), checks })
    }
    return out
}

export { auditClaims, groupRoot }

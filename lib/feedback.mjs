// Household feedback, anonymous and proven (accountability to affected people, CHS commitments 4 and 5): an
// enrolled household rates the aid once per program with a Semaphore proof of membership in its program's group,
// checked on-chain by Semaphore's own validateProof. Naungan checks claims against its own nullifier set, never
// Semaphore's, so the two cannot collide; the feedback scope differs from the claim's, so its nullifier cannot be
// linked to the household's claim, and Semaphore refuses a second rating from the same household.
// Every ProofValidated event under that scope is a rating from a distinct enrolled household: no account, no name.
import { keccak256, toUtf8Bytes } from "ethers"

/** What went wrong, if anything; 0 is "nothing to add". Order is part of the on-chain encoding: append only. */
export const TOPICS = ["none", "late", "tooLittle", "cashOut", "leftOut"]

/** The feedback scope of a program: per deployment, and far above any program id (a claim's scope). */
export const feedbackScope = (naungan, pid) => BigInt(keccak256(toUtf8Bytes(`naungan-feedback:${String(naungan).toLowerCase()}:${pid}`)))

/** rating 1–5 and a topic index → the proof's message (topic × 10 + rating). */
export function encode(rating, topic = 0) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !Number.isInteger(topic) || topic < 0 || topic >= TOPICS.length) throw new Error("rating must be 1–5 and topic one of TOPICS")
    return BigInt(topic * 10 + rating)
}

/** The proof's message → { rating, topic }, or null when it is not a feedback message. */
export function decode(message) {
    const m = BigInt(message)
    if (m > 99n) return null
    const rating = Number(m % 10n), topic = Number(m / 10n)
    return rating >= 1 && rating <= 5 && topic < TOPICS.length ? { rating, topic } : null
}

/** Messages of a program's feedback proofs → counts per rating (index 0 = 1 star) and per topic, and the mean. */
export function summarise(messages) {
    const ratings = [0, 0, 0, 0, 0], topics = Object.fromEntries(TOPICS.map((t) => [t, 0]))
    for (const f of messages.map(decode).filter(Boolean)) ratings[f.rating - 1]++, topics[TOPICS[f.topic]]++
    const count = ratings.reduce((a, b) => a + b, 0)
    return { count, mean: count ? Math.round((ratings.reduce((a, n, i) => a + n * (i + 1), 0) / count) * 10) / 10 : null, ratings, topics }
}

/** Semaphore v4's ProofValidated(groupId indexed, depth, root indexed, nullifier, message, scope indexed, points). */
export const PROOF_VALIDATED = "event ProofValidated(uint256 indexed groupId, uint256 merkleTreeDepth, uint256 indexed merkleTreeRoot, uint256 nullifier, uint256 message, uint256 indexed scope, uint256[8] points)"

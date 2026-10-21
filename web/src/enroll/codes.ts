// Registration codes a household's phone shows after self-registering (claim#join=<program>):
// "naungan-commitment:<program>:<commitment>". The commitment is public by design (it goes on-chain at enrollment);
// the identity secret behind it never leaves the phone, so the agency enrolls someone it can never claim for.

// BN254 scalar field: a Semaphore identity commitment is a Poseidon hash, always below this.
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

export type Verdict = { ok: true; commitment: string } | { ok: false; why: string }

/** One scanned or pasted code → the commitment to enroll, or why it is refused (said to the agency worker). */
export function readCode(raw: string, pid: bigint, have: ReadonlySet<string>, enrolled: ReadonlySet<string>): Verdict {
    const m = raw.trim().match(/^naungan-commitment:(\d{1,20}):(\d{1,80})$/)
    if (!m) return { ok: false, why: "not a Naungan registration code" }
    if (BigInt(m[1]) !== pid) return { ok: false, why: `registered for program #${m[1]}, not #${pid}: open the phone's link for this program` }
    const c = BigInt(m[2])
    if (c === 0n || c >= FIELD) return { ok: false, why: "damaged code (not a valid commitment)" }
    const s = c.toString()
    if (enrolled.has(s)) return { ok: false, why: "already enrolled in this program" }
    if (have.has(s)) return { ok: false, why: "already scanned" }
    return { ok: true, commitment: s }
}

/** Pasted text (one code per line, or a CSV whose cells hold codes) → each code found, in order. */
export const codesIn = (text: string) => text.match(/naungan-commitment:\d+:\d+/g) ?? []

/** Enrollment goes out in chunks so one transaction stays well inside the block gas limit (Semaphore inserts cost ~30k gas each). */
export const chunks = <T>(xs: T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

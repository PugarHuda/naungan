import type { Program } from "../shared/chain"
import type { Report } from "./state.svelte"

/** A report counts toward the trigger for REPORT_TTL (24 h) after it was posted. */
export const fresh = (r: Report, now: number) => r.ts > 0n && now - Number(r.ts) <= 86400

/**
 * The trigger needs `quorum` fresh reports at/above the threshold, so the headline is the quorum-th
 * strongest fresh reading (the latest single report would overstate a 2-of-2 program).
 */
export const level = (p: Program, reps: Report[], now: number) =>
    reps.filter((r) => fresh(r, now)).map((r) => Number(r.value)).sort((x, y) => y - x)[Number(p.quorum) - 1] ?? 0

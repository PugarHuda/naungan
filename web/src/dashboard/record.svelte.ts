// The selected program's track record (lib/hazard.mjs via verify.mjs), fetched once on demand and read by
// both the track record panel and the IFRC comparison.
import { dash } from "./state.svelte"

export type Episode = { start: string; end: string; peak: number; peakDate: string }
export type History = { flood: { from: string; to: string; threshold: number }; rain: { threshold: number } | null; paid: Episode[]; rainOnly: Episode[] }

class Record {
    pid = $state<bigint>()
    r = $state.raw<History | null>(null)
    busy = $state(false)
    error = $state<string | null>(null)
}
export const record = new Record()

/** Replays the program's trigger; a result for a program the visitor has since left is dropped. */
export async function loadRecord() {
    const id = dash.pid, m = dash.meta
    if (id === undefined || !m.name) throw new Error("Still connecting to the chain. Try again in a few seconds.")
    if (record.pid === id && record.r) return
    record.pid = id
    record.r = null
    record.error = null
    record.busy = true
    try {
        const r: History = await (await import("../shared/verify.mjs")).trackRecord(m)
        if (id === dash.pid) record.r = r
    } catch (e) {
        if (id === dash.pid) record.error = (e as Error).message
    } finally {
        if (id === dash.pid) record.busy = false
    }
}

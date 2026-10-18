// In-browser oracle audit: re-run an oracle's computation from the public data source with the exact
// code the oracle runs (lib/hazard.js) and compare it with the value it put on-chain. No trust in us,
// the oracle key or our servers: only Open-Meteo's public API and the chain.
import hazard from "../../lib/hazard.js"

/**
 * Which computation produced an evidence string, and with what inputs. Replays name their window and
 * are deterministic; live readings name the forecast run, which Open-Meteo replaces daily.
 */
export function parseEvidence(evidence) {
    const rain = /^(REPLAY of ERA5|NOAA GEFS)/.test(evidence)
    const glofas = /^(REPLAY of GloFAS|GloFAS)/.test(evidence)
    if (!rain && !glofas) return null
    const replay = /^REPLAY/.test(evidence) ? evidence.match(/window (\d{4}-\d{2}-\d{2})\.\./)?.[1] : null
    const run = evidence.match(/run (\d{4}-\d{2}-\d{2})/)?.[1] ?? null
    return { pipeline: rain ? "rain" : "glofas", replay, run }
}

/** Recompute one report. Returns { value, evidence, comparable, why } where comparable means same inputs. */
/** Same climatology code the oracles run, for the landing page's live forecast chart. */
export const { floodThreshold } = hazard

/**
 * A program's track record over the reanalysis: when each oracle's hazard was above its trigger level
 * and, for a 2-of-2 program, when both were within the lead time of each other (what the quorum pays on).
 * Rain episodes are clipped to the GloFAS period so the two counts cover the same years.
 */
export async function trackRecord(meta) {
    const flood = await hazard.floodHistory(meta)
    if (!meta.rain) return { flood, rain: null, paid: flood.episodes, rainOnly: [] }
    const rain = await hazard.rainHistory(meta)
    const inPeriod = rain.episodes.filter((e) => e.end >= flood.from)
    const paid = hazard.agree(flood.episodes, inPeriod, meta.leadDays)
    const rainOnly = inPeriod.filter((r) => !hazard.agree([r], flood.episodes, meta.leadDays).length)
    return { flood, rain: { ...rain, episodes: inPeriod }, paid, rainOnly }
}

export async function recheck(meta, report) {
    const e = parseEvidence(report.evidence)
    if (!e) throw new Error("this report's evidence names no known pipeline")
    const [live, past] = e.pipeline === "rain" ? [hazard.assessRain, hazard.replayRain] : [hazard.assess, hazard.replay]
    const r = e.replay ? await past({ ...meta, date: e.replay }) : await live(meta)
    const runNow = parseEvidence(r.evidence).run
    const comparable = Boolean(e.replay) || runNow === e.run
    return {
        value: r.probability,
        evidence: r.evidence,
        comparable,
        why: e.replay ? `replay of ${e.replay}` : comparable ? `same forecast run ${e.run}` : `forecast run ${e.run} has been replaced by ${runNow}`
    }
}

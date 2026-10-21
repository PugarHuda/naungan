// Landing-page helpers: the shape of a track record (web/src/shared/verify.mjs trackRecord), date formatting,
// and the GloFAS forecast the hero and the river check both draw.
import { floodThreshold } from "../shared/verify.mjs"

export type Episode = { start: string; end: string; peak: number; peakDate: string }
export type History = { threshold: number; unit?: string; years?: number; from: string; to: string; episodes: Episode[] }
export type TrackRecord = { flood: History; rain: History | null; paid: Episode[]; rainOnly: Episode[] }
export type FloodMeta = { name?: string; lat: number; lon: number; returnPeriod: number; leadDays: number; rain?: { returnPeriod: number } }

export const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
export const years = (r: TrackRecord) => Math.round((Date.parse(r.flood.to) - Date.parse(r.flood.from)) / 3.156e10)

export type Forecast = { time: string[]; median: (number | null)[]; max: (number | null)[]; threshold: number; peak: number }

/** GloFAS median and wettest member for the next 30 days, against the program's flood level. */
export async function forecast(meta: FloodMeta): Promise<Forecast> {
    const r = await fetch(`https://flood-api.open-meteo.com/v1/flood?latitude=${meta.lat}&longitude=${meta.lon}&daily=river_discharge_median,river_discharge_max&forecast_days=30`, { signal: AbortSignal.timeout(20e3) })
    if (!r.ok) throw new Error(`GloFAS forecast ${r.status}`)
    const j = await r.json()
    const { threshold } = await floodThreshold(meta)
    const median: (number | null)[] = j.daily.river_discharge_median
    return { time: j.daily.time, median, max: j.daily.river_discharge_max, threshold, peak: Math.max(...median.slice(0, 11).filter((v): v is number => v != null)) }
}

/** What the hero's phone mock-up shows, read from the chain. */
export type Live = {
    net: string
    addr: string
    addrHref?: string
    pname: string
    pdate: string
    now: string
    trig: string
    fired: boolean
    enrolled: string
    paid: string
    usd: string
    nprog: string
    featured?: FloodMeta
}

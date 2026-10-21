// The hero chart's geometry. Flood programs: GloFAS's 30-day river forecast for the program's cell against the
// flood level its trigger uses (lib/hazard.mjs floodThreshold, the oracle's own climatology). Heat programs: the
// 16-day NOAA GEFS maximum-temperature ensemble (the oracle's own request, heatForecast) against the heatwave
// temperature. Cyclone wind programs: the 16-day GEFS peak-gust ensemble (windForecast) against the place's
// 1-in-T-year gust (windThreshold). All shade the trigger's lead window.
import type { ProgramMeta } from "../shared/chain"
import { day } from "./format"

export type Chart = {
    lead: { x: number; y: number; w: number; h: number }
    grid: { y: number; label: number }[]
    area: string
    areaFill: string
    median: string
    level: { y: number; label: string }
    axis: string
    xs: { x: number; label: string; anchor: "start" | "middle" | "end" }[]
    leadText: string
    note: string
}

const W = 760, H = 300, L = 52, R = 12, T = 14, B = 34
const shortDay = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

function frame(n: number, lo: number, hi: number, leadDays: number) {
    const x = (i: number) => L + (i / (n - 1)) * (W - L - R)
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
    const line = (vals: (number | null)[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v ?? lo).toFixed(1)}`).join("")
    const grid = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) / 4) * k).map((v) => ({ y: y(v), label: Math.round(v) }))
    return { x, y, line, grid, lead: { x: L, y: T, w: x(Math.min(leadDays, n - 1)) - L, h: H - T - B } }
}
const ticks = (x: (i: number) => number, at: number[], time: string[], last: number) =>
    at.map((i) => ({ x: x(i), label: i === 0 ? "Today" : shortDay(time[i]), anchor: (i === 0 ? "start" : i === last ? "end" : "middle") as "start" | "middle" | "end" }))

export async function floodChart(meta: ProgramMeta): Promise<Chart> {
    const r = await fetch(`https://flood-api.open-meteo.com/v1/flood?latitude=${meta.lat}&longitude=${meta.lon}&daily=river_discharge_median,river_discharge_max&forecast_days=30`, { signal: AbortSignal.timeout(20e3) })
    if (!r.ok) throw new Error(`GloFAS ${r.status}`)
    const j = await r.json()
    const { threshold } = await (await import("../shared/verify.mjs")).floodThreshold(meta as { lat: number; lon: number; returnPeriod: number }) // flood programs always carry all three
    const time: string[] = j.daily.time, n = time.length, lead = meta.leadDays ?? 0
    const med: (number | null)[] = j.daily.river_discharge_median, max: (number | null)[] = j.daily.river_discharge_max
    const top = Math.max(threshold * 1.18, ...max.filter((v): v is number => v != null))
    const f = frame(n, 0, top, lead)
    const peak = Math.max(...med.slice(0, lead + 1).filter((v): v is number => v != null))
    return {
        lead: f.lead,
        grid: f.grid,
        area: `${f.line(max)}L${f.x(n - 1)},${f.y(0)}L${L},${f.y(0)}Z`,
        areaFill: "rgba(61,210,123,.25)",
        median: f.line(med),
        level: { y: f.y(threshold), label: `Flood level ${Math.round(threshold)} m³/s` },
        axis: "m³/s",
        xs: ticks(f.x, [0, 7, 14, 21, 29], time, 29),
        leadText: `Next ${lead} days: what the trigger looks at`,
        note: `GloFAS forecast run ${day(time[0])} for ${(meta.name ?? "").split(" · ")[0]}. The median peaks at ${Math.round(peak)} m³/s in the next ${lead} days, ${peak >= threshold ? "above" : `${Math.round((1 - peak / threshold) * 100)}% below`} the flood level.`
    }
}

export async function heatChart(meta: ProgramMeta): Promise<Chart> {
    const v = await import("../shared/verify.mjs")
    const { cells, tmax, tmin, days } = v.heatParams(meta)
    const f = await v.heatForecast({ cells, leadDays: 16 })
    const at = (i: number) => (f.series as (number | null)[][]).map((s) => s[i]).filter((x): x is number => x != null).sort((a, b) => a - b)
    // The last forecast day can come back empty for every member: chart only the days that have data.
    const time: string[] = f.time
    const empty = time.findIndex((_, i) => at(i).length === 0)
    const n = empty < 0 ? time.length : empty
    if (n < 2) throw new Error("GEFS returned no temperature forecast")
    const med = time.slice(0, n).map((_, i) => at(i)[at(i).length >> 1]), max = time.slice(0, n).map((_, i) => at(i).at(-1)!)
    const lead = meta.leadDays ?? 0
    const lo = Math.floor(Math.min(...med) - 3), hi = Math.ceil(Math.max(tmax + 2, ...max))
    const g = frame(n, lo, hi, lead)
    const peak = Math.max(...med.slice(0, lead))
    return {
        lead: g.lead,
        grid: g.grid,
        area: `${g.line(max)}L${g.x(n - 1)},${g.y(lo)}L${L},${g.y(lo)}Z`,
        areaFill: "rgba(240,128,60,.22)",
        median: g.line(med),
        level: { y: g.y(tmax), label: `Heatwave: ${days}+ days above ${tmax} °C${tmin == null ? "" : `, nights above ${tmin} °C`}` },
        axis: "°C, daily max",
        xs: ticks(g.x, [0, 5, 10, n - 1], time, n - 1),
        leadText: `Next ${lead} days: what the trigger looks at`,
        note: `NOAA GEFS run ${day(time[0])} for ${(meta.name ?? "").split(" · ")[0]}, ${f.series.length} ensemble members. The median hottest day in the next ${lead} days is ${peak.toFixed(1)} °C, ${peak > tmax ? "above" : `${(tmax - peak).toFixed(1)} °C below`} the heatwave level.`
    }
}

export async function windChart(meta: ProgramMeta): Promise<Chart> {
    const v = await import("../shared/verify.mjs")
    const w = v.windParams(meta)
    const [{ threshold }, f] = await Promise.all([v.windThreshold(w), v.windForecast({ cells: w.cells, leadDays: 16 })])
    const at = (i: number) => (f.series as (number | null)[][]).map((s) => s[i]).filter((x): x is number => x != null).sort((a, b) => a - b)
    const time: string[] = f.time
    const empty = time.findIndex((_, i) => at(i).length === 0)
    const n = empty < 0 ? time.length : empty
    if (n < 2) throw new Error("GEFS returned no wind forecast")
    const med = time.slice(0, n).map((_, i) => at(i)[at(i).length >> 1]), max = time.slice(0, n).map((_, i) => at(i).at(-1)!)
    const lead = meta.leadDays ?? 0
    const hi = Math.ceil(Math.max(threshold * 1.15, ...max))
    const g = frame(n, 0, hi, lead)
    const peak = Math.max(...med.slice(0, lead))
    return {
        lead: g.lead,
        grid: g.grid,
        area: `${g.line(max)}L${g.x(n - 1)},${g.y(0)}L${L},${g.y(0)}Z`,
        areaFill: "rgba(90,120,220,.22)",
        median: g.line(med),
        level: { y: g.y(threshold), label: `1-in-${w.returnPeriod}-year gust ${Math.round(threshold)} km/h` },
        axis: "km/h, daily peak gust",
        xs: ticks(g.x, [0, 5, 10, n - 1], time, n - 1),
        leadText: `Next ${lead} days: what the trigger looks at`,
        note: `NOAA GEFS run ${day(time[0])} for ${(meta.name ?? "").split(" · ")[0]}, ${f.series.length} ensemble members. The median strongest gust in the next ${lead} days is ${Math.round(peak)} km/h, ${peak > threshold ? "above" : `${Math.round((1 - peak / threshold) * 100)}% below`} the place's 1-in-${w.returnPeriod}-year gust in ERA5.`
    }
}

export const CHART = { W, H, L, R, T, B }

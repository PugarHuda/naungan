// Flood trigger data: GloFAS v4 (Copernicus EMS) river discharge, served free by Open-Meteo.
// This is the same forecast IFRC Early Action Protocols trigger on (e.g. Uganda Red Cross:
// act when GloFAS gives >= 60-70% probability of a 1-in-5-year flood within the lead time).
const API = "https://flood-api.open-meteo.com/v1/flood"
// Second, independent pipeline for a 2-of-2 quorum: NOAA GEFS rainfall ensemble (a different model,
// agency and variable from Copernicus GloFAS) against the ERA5 rainfall climatology.
const GEFS = "https://ensemble-api.open-meteo.com/v1/ensemble"
const ERA5 = "https://archive-api.open-meteo.com/v1/archive"
// Heatwaves use the same two sources with daily maximum temperature. Unlike floods, heat protocols act on an
// absolute temperature, because the body's limit does not move with the local climate: Bangladesh Red
// Crescent's Dhaka heatwave EAP acts when ECMWF/GFS forecast above 38 °C on 2+ consecutive days.
const EULER = 0.5772156649

async function getJSON(url, tries = 3) {
    for (let i = 1; ; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
            if (!res.ok) throw Object.assign(new Error(`${res.status} ${await res.text()}`), { status: res.status })
            return await res.json()
        } catch (e) {
            if (i >= tries) throw new Error(`${new URL(url).host} request failed: ${e.message}`)
            // Open-Meteo's free tier limits requests per minute (a 42-year, 5-cell climatology is heavy): wait it out.
            await new Promise((r) => setTimeout(r, e.status === 429 ? 61e3 : 1000 * i))
        }
    }
}

/**
 * Return-period thresholds come from complete past years only, so they change once a year. In a browser
 * (the dashboard re-check) keep the computed result in localStorage: a 42-year, 5-cell climatology is a
 * heavy request on Open-Meteo's free quota. The key includes the last year, so it refreshes each January.
 */
async function memo(key, fn) {
    let store
    try { store = globalThis.localStorage } catch {}
    try {
        const hit = store?.getItem(key)
        if (hit) return JSON.parse(hit)
    } catch {}
    const v = await fn()
    try { store?.setItem(key, JSON.stringify(v)) } catch {}
    return v
}

/** Yearly peak discharge, complete years only (a partial year would bias the fit low). */
function annualMaxima(time, values) {
    const years = {}
    time.forEach((t, i) => {
        const y = t.slice(0, 4)
        ;(years[y] ??= { n: 0, max: -Infinity }).n++
        if (values[i] != null) years[y].max = Math.max(years[y].max, values[i])
    })
    return Object.values(years).filter((y) => y.n >= 365 && Number.isFinite(y.max)).map((y) => y.max)
}

/** Discharge of the 1-in-T-year flood: Gumbel (EV1) fitted to annual maxima by method of moments. */
function returnLevel(maxima, T) {
    if (maxima.length < 10) throw new Error(`need >= 10 years of annual maxima, got ${maxima.length}`)
    const n = maxima.length
    const mean = maxima.reduce((s, x) => s + x, 0) / n
    const sd = Math.sqrt(maxima.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
    const beta = (sd * Math.sqrt(6)) / Math.PI
    return mean - EULER * beta - beta * Math.log(-Math.log(1 - 1 / T))
}

/** Share of ensemble members whose peak over the lead window exceeds the threshold, in whole %. */
function exceedance(members, threshold) {
    const over = members.filter((m) => Math.max(...m.filter((v) => v != null)) > threshold).length
    return { over, members: members.length, probability: Math.round((100 * over) / members.length) }
}

async function floodThreshold({ lat, lon, returnPeriod }) {
    const end = `${new Date().getUTCFullYear() - 1}-12-31`
    return memo(`naungan:glofas:${lat},${lon}:${returnPeriod}:${end}`, async () => {
        const j = await getJSON(`${API}?latitude=${lat}&longitude=${lon}&daily=river_discharge&start_date=1984-01-01&end_date=${end}`)
        const maxima = annualMaxima(j.daily.time, j.daily.river_discharge)
        return { threshold: returnLevel(maxima, returnPeriod), years: maxima.length, cell: [j.latitude, j.longitude] }
    })
}

async function floodForecast({ lat, lon, leadDays }) {
    const j = await getJSON(`${API}?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=${leadDays}&ensemble=true`)
    const members = Object.keys(j.daily).filter((k) => k.startsWith("river_discharge_member")).map((k) => j.daily[k])
    if (members.length === 0) throw new Error("GloFAS returned no ensemble members")
    return { members, run: j.daily.time[0], cell: [j.latitude, j.longitude] }
}

/**
 * Full trigger computation for one program. Returns the on-chain value (probability %) and a
 * compact evidence string anyone can re-derive from the same public API.
 */
async function assess({ lat, lon, returnPeriod, leadDays }) {
    const [{ threshold, years }, { members, run, cell }] = await Promise.all([
        floodThreshold({ lat, lon, returnPeriod }),
        floodForecast({ lat, lon, leadDays })
    ])
    const e = exceedance(members, threshold)
    const peaks = members.map((m) => Math.max(...m.filter((v) => v != null))).sort((a, b) => a - b)
    const median = peaks[peaks.length >> 1]
    const evidence =
        `GloFAS v4 via Open-Meteo | cell ${cell[0].toFixed(3)},${cell[1].toFixed(3)} | run ${run} | lead ${leadDays}d | ` +
        `1-in-${returnPeriod}y flood ${threshold.toFixed(0)} m3/s (Gumbel, ${years}y reanalysis) | ` +
        `${e.over}/${e.members} members exceed | median peak ${median.toFixed(0)} m3/s`
    return { ...e, threshold, years, run, medianPeak: median, evidence }
}

/**
 * Replay a past real event: the GloFAS reanalysis peak over [date, date + leadDays] against the same
 * threshold. Deterministic (0 or 100) and labelled REPLAY in the evidence, never passed off as a forecast.
 */
async function replay({ lat, lon, returnPeriod, leadDays, date }) {
    const end = new Date(Date.parse(date) + (leadDays - 1) * 864e5).toISOString().slice(0, 10)
    const [{ threshold, years }, j] = await Promise.all([
        floodThreshold({ lat, lon, returnPeriod }),
        getJSON(`${API}?latitude=${lat}&longitude=${lon}&daily=river_discharge&start_date=${date}&end_date=${end}`)
    ])
    const vals = j.daily.river_discharge.filter((v) => v != null)
    if (vals.length === 0) throw new Error(`No reanalysis data for ${date}`)
    const peak = Math.max(...vals)
    const probability = peak > threshold ? 100 : 0
    const evidence =
        `REPLAY of GloFAS v4 reanalysis via Open-Meteo (not a live forecast) | cell ${j.latitude.toFixed(3)},${j.longitude.toFixed(3)} | ` +
        `window ${date}..${end} | peak ${peak.toFixed(0)} m3/s on ${j.daily.time[j.daily.river_discharge.indexOf(peak)]} | ` +
        `1-in-${returnPeriod}y flood ${threshold.toFixed(0)} m3/s (Gumbel, ${years}y)`
    return { probability, threshold, years, peak, evidence }
}

/** Rolling `days`-day totals, aligned so out[i] is the sum ending on day i (null until the window fills). */
function rolling(values, days) {
    let sum = 0, gaps = 0
    return values.map((v, i) => {
        sum += v ?? 0, gaps += v == null
        if (i >= days) sum -= values[i - days] ?? 0, gaps -= values[i - days] == null
        return i >= days - 1 && gaps === 0 ? sum : null
    })
}

/**
 * Rain parameters of a program. `rain.cells` are grid points across the river's catchment (rain that
 * floods a river falls upstream, not at the gauge); `rain.returnPeriod` is usually shorter than the
 * flood's, because the rain oracle corroborates GloFAS rather than triggering alone.
 */
const rainParams = (m) => ({ cells: m.rain?.cells ?? [[m.lat, m.lon]], returnPeriod: m.rain?.returnPeriod ?? m.returnPeriod, leadDays: m.leadDays })

/** One request for all cells; returns each daily `fields` series averaged over the catchment. */
async function catchment(url, cells, fields) {
    let r = await getJSON(`${url}&latitude=${cells.map((c) => c[0])}&longitude=${cells.map((c) => c[1])}`)
    if (!Array.isArray(r)) r = [r] // one location comes back as an object
    const time = r[0].daily.time
    const mean = (f) => time.map((_, i) => {
        const v = r.map((x) => x.daily[f]?.[i])
        return v.some((x) => x == null) ? null : v.reduce((s, x) => s + x, 0) / v.length
    })
    return { time, series: (fields ?? Object.keys(r[0].daily).filter((k) => k !== "time")).map(mean) }
}

async function rainThreshold({ cells, returnPeriod, leadDays }) {
    const end = `${new Date().getUTCFullYear() - 1}-12-31`
    return memo(`naungan:rain:${cells.join(";")}:${returnPeriod}:${leadDays}:${end}`, async () => {
        const { time, series: [rain] } = await catchment(`${ERA5}?daily=precipitation_sum&start_date=1984-01-01&end_date=${end}`, cells, ["precipitation_sum"])
        const maxima = annualMaxima(time, rolling(rain, leadDays))
        return { threshold: returnLevel(maxima, returnPeriod), years: maxima.length }
    })
}

/**
 * Rain trigger: share of GEFS members whose catchment-mean `leadDays` rainfall beats the 1-in-T-year
 * `leadDays`-day total from ERA5. Same output shape as assess(), so the contract treats both alike.
 */
async function assessRain(m) {
    const { cells, returnPeriod, leadDays } = rainParams(m)
    const [{ threshold, years }, f] = await Promise.all([
        rainThreshold({ cells, returnPeriod, leadDays }),
        catchment(`${GEFS}?daily=precipitation_sum&models=gfs025&forecast_days=${leadDays}`, cells)
    ])
    const totals = f.series.map((m) => m.reduce((s, v) => s + (v ?? 0), 0)) // control run + perturbed members
    if (totals.length < 2) throw new Error("GEFS returned no ensemble members")
    const over = totals.filter((t) => t > threshold).length
    const probability = Math.round((100 * over) / totals.length)
    const median = [...totals].sort((a, b) => a - b)[totals.length >> 1]
    const evidence =
        `NOAA GEFS 0.25 rainfall via Open-Meteo | catchment mean of ${cells.length} cells | run ${f.time[0]} | lead ${leadDays}d | ` +
        `1-in-${returnPeriod}y ${leadDays}-day rain ${threshold.toFixed(0)} mm (Gumbel, ${years}y ERA5) | ` +
        `${over}/${totals.length} members exceed | median total ${median.toFixed(0)} mm`
    return { over, members: totals.length, probability, threshold, years, medianTotal: median, evidence }
}

/** Rain counterpart of replay(): the observed ERA5 catchment total over [date, date + leadDays) against the same threshold. */
async function replayRain(m) {
    const { cells, returnPeriod, leadDays } = rainParams(m)
    const end = new Date(Date.parse(m.date) + (leadDays - 1) * 864e5).toISOString().slice(0, 10)
    const [{ threshold, years }, { series: [vals] }] = await Promise.all([
        rainThreshold({ cells, returnPeriod, leadDays }),
        catchment(`${ERA5}?daily=precipitation_sum&start_date=${m.date}&end_date=${end}`, cells, ["precipitation_sum"])
    ])
    if (vals.some((v) => v == null)) throw new Error(`No complete ERA5 rainfall for ${m.date}..${end}`)
    const total = vals.reduce((s, v) => s + v, 0)
    const probability = total > threshold ? 100 : 0
    const evidence =
        `REPLAY of ERA5 observed rainfall via Open-Meteo (not a live forecast) | catchment mean of ${cells.length} cells | ` +
        `window ${m.date}..${end} | total ${total.toFixed(0)} mm | 1-in-${returnPeriod}y ${leadDays}-day rain ${threshold.toFixed(0)} mm (Gumbel, ${years}y)`
    return { probability, threshold, years, total, evidence }
}

/** Runs of days above `threshold`, merged when they are at most `gap` days apart: one flood, one episode. */
function episodes(time, values, threshold, gap = 7) {
    const out = []
    values.forEach((v, i) => {
        if (v == null || v <= threshold) return
        const last = out.at(-1)
        if (last && Date.parse(time[i]) - Date.parse(last.end) <= gap * 864e5) {
            last.end = time[i]
            if (v > last.peak) (last.peak = v), (last.peakDate = time[i])
        } else out.push({ start: time[i], end: time[i], peak: v, peakDate: time[i] })
    })
    return out
}

/** Episodes of `a` that an episode of `b` overlaps within `slack` days: when a 2-of-2 quorum agrees. */
const agree = (a, b, slack) => a.filter((x) => b.some((y) => Date.parse(y.start) - slack * 864e5 <= Date.parse(x.end) && Date.parse(x.start) - slack * 864e5 <= Date.parse(y.end)))

/**
 * Track record: every day since 1984 the hazard was above this program's trigger level in the
 * reanalysis, i.e. what a perfect forecast would have fired on. Same threshold as the oracle (fitted on
 * complete past years). Says how often the program would have paid; it does not measure forecast skill.
 */
async function floodHistory({ lat, lon, returnPeriod }) {
    const until = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    return memo(`naungan:glofas-history:${lat},${lon}:${returnPeriod}:${until}`, async () => {
        const j = await getJSON(`${API}?latitude=${lat}&longitude=${lon}&daily=river_discharge&start_date=1984-01-01&end_date=${until}`)
        const { time, river_discharge: q } = j.daily
        const cut = `${new Date().getUTCFullYear() - 1}-12-31`
        const n = time.findLastIndex((t) => t <= cut) + 1
        const maxima = annualMaxima(time.slice(0, n), q.slice(0, n))
        const threshold = returnLevel(maxima, returnPeriod)
        return { threshold, unit: "m3/s", years: maxima.length, from: time[q.findIndex((v) => v != null)], to: time[q.findLastIndex((v) => v != null)], episodes: episodes(time, q, threshold) }
    })
}

/** Rain counterpart: days whose catchment-mean `leadDays`-day ERA5 total beat the 1-in-T-year total. */
async function rainHistory(m) {
    const { cells, returnPeriod, leadDays } = rainParams(m)
    const until = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    return memo(`naungan:rain-history:${cells.join(";")}:${returnPeriod}:${leadDays}:${until}`, async () => {
        const { time, series: [rain] } = await catchment(`${ERA5}?daily=precipitation_sum&start_date=1984-01-01&end_date=${until}`, cells, ["precipitation_sum"])
        const sums = rolling(rain, leadDays)
        const cut = `${new Date().getUTCFullYear() - 1}-12-31`
        const n = time.findLastIndex((t) => t <= cut) + 1
        const maxima = annualMaxima(time.slice(0, n), sums.slice(0, n))
        const threshold = returnLevel(maxima, returnPeriod)
        return { threshold, unit: "mm", years: maxima.length, from: time[sums.findIndex((v) => v != null)], to: time[sums.findLastIndex((v) => v != null)], episodes: episodes(time, sums, threshold) }
    })
}

/**
 * Heat parameters of a program: grid cells to average, the day temperature and how many consecutive days
 * make a heatwave, and optionally `tmin`, a night (daily minimum) temperature those days must stay above
 * too, as in Karachi's emergency rule (above 42 C by day and 30 C by night, two days running).
 */
const heatParams = (m) => ({ cells: m.heat?.cells ?? [[m.lat, m.lon]], tmax: m.heat?.tmax ?? 38, tmin: m.heat?.tmin ?? null, days: m.heat?.days ?? 2, leadDays: m.leadDays })

/** Longest run of consecutive days above `t` (and, given `mins`, nights above `tmin`); a missing day breaks the run. */
function longestRun(values, t, mins = null, tmin = null) {
    let best = 0, run = 0
    values.forEach((v, i) => {
        const hot = v != null && v > t && (mins == null || (mins[i] != null && mins[i] > tmin))
        run = hot ? run + 1 : 0
        best = Math.max(best, run)
    })
    return best
}

/** Daily ensemble temperature over the cells (`temperature_2m_max` or `_min`): one series per GEFS member, control run first. */
const heatForecast = ({ cells, leadDays, field = "temperature_2m_max" }) => catchment(`${GEFS}?daily=${field}&models=gfs025&forecast_days=${leadDays}`, cells)
/** How a program defines its heatwave, in the words every evidence string uses. */
const heatwave = ({ days, tmax, tmin }) => `heatwave = ${days}+ days above ${tmax} C${tmin == null ? "" : ` (nights above ${tmin} C)`}`

/**
 * Heat trigger: share of GEFS members that forecast `days` or more consecutive days above `tmax`
 * within the lead time. Same output shape as assess(), so the contract treats every hazard alike.
 */
async function assessHeat(m) {
    const h = heatParams(m), { cells, tmax, tmin, days, leadDays } = h
    const f = await heatForecast({ cells, leadDays })
    if (f.series.length < 2) throw new Error("GEFS returned no ensemble members")
    // Each member's nights come from the same member's minimum temperature run.
    const nights = tmin == null ? null : (await heatForecast({ cells, leadDays, field: "temperature_2m_min" })).series
    if (nights && nights.length !== f.series.length) throw new Error("GEFS returned different members for max and min temperature")
    const over = f.series.filter((s, i) => longestRun(s, tmax, nights?.[i], tmin) >= days).length
    const probability = Math.round((100 * over) / f.series.length)
    const hottest = f.series.map((s) => Math.max(...s.filter((v) => v != null))).sort((a, b) => a - b)
    const median = hottest[hottest.length >> 1]
    const evidence =
        `NOAA GEFS 0.25 max temperature via Open-Meteo | mean of ${cells.length} cells | run ${f.time[0]} | lead ${leadDays}d | ` +
        `${heatwave(h)} | ${over}/${f.series.length} members | median hottest day ${median.toFixed(1)} C`
    return { over, members: f.series.length, probability, threshold: tmax, medianHottest: median, evidence }
}

/** Heat counterpart of replay(): observed ERA5 maximum temperature over [date, date + leadDays). */
async function replayHeat(m) {
    const h = heatParams(m), { cells, tmax, tmin, days, leadDays } = h
    const end = new Date(Date.parse(m.date) + (leadDays - 1) * 864e5).toISOString().slice(0, 10)
    const { series: [t, lo] } = await catchment(`${ERA5}?daily=temperature_2m_max,temperature_2m_min&start_date=${m.date}&end_date=${end}`, cells, ["temperature_2m_max", "temperature_2m_min"])
    if (t.some((v) => v == null)) throw new Error(`No complete ERA5 temperature for ${m.date}..${end}`)
    const run = longestRun(t, tmax, tmin == null ? null : lo, tmin)
    const probability = run >= days ? 100 : 0
    const evidence =
        `REPLAY of ERA5 observed max temperature via Open-Meteo (not a live forecast) | mean of ${cells.length} cells | ` +
        `window ${m.date}..${end} | ${run} consecutive days above ${tmax} C${tmin == null ? "" : ` with nights above ${tmin} C`}, hottest ${Math.max(...t).toFixed(1)} C | ${heatwave(h)}`
    return { probability, threshold: tmax, run, evidence }
}

/** Heat counterpart of floodHistory(): every ERA5 heatwave since 1984 by the program's own definition. */
async function heatHistory(m) {
    const { cells, tmax, tmin, days } = heatParams(m)
    const until = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    return memo(`naungan:heat-history:${cells.join(";")}:${tmax}:${tmin}:${days}:${until}`, async () => {
        const { time, series: [t, lo] } = await catchment(`${ERA5}?daily=temperature_2m_max,temperature_2m_min&start_date=1984-01-01&end_date=${until}`, cells, ["temperature_2m_max", "temperature_2m_min"])
        // Keep only days inside a run of `days`+ hot days, so a single hot afternoon is not an episode.
        const inRun = t.map(() => null)
        for (let i = 0, run = 0; i <= t.length; i++) {
            if (i < t.length && t[i] != null && t[i] > tmax && (tmin == null || (lo[i] != null && lo[i] > tmin))) { run++; continue }
            if (run >= days) for (let k = i - run; k < i; k++) inRun[k] = t[k]
            run = 0
        }
        const years = new Set(time.filter((_, i) => t[i] != null).map((d) => d.slice(0, 4))).size
        return { threshold: tmax, unit: "C", years, from: time[t.findIndex((v) => v != null)], to: time[t.findLastIndex((v) => v != null)], episodes: episodes(time, inRun, tmax, 7) }
    })
}

/**
 * The GloFAS cell an oracle should read near a place: GloFAS routes rivers on a 0.05° grid, so the cell
 * under a town is often a side stream. Scans a (2·span/step+1)² grid around the point and returns the cell
 * with the highest mean discharge over the last full year (a dry season alone would mislead), with its
 * distance from the point.
 */
async function riverCell(lat, lon, { span = 0.1, step = 0.05 } = {}) {
    const lats = [], lons = []
    for (let a = -span; a <= span + 1e-9; a += step) for (let b = -span; b <= span + 1e-9; b += step) lats.push((lat + a).toFixed(3)), lons.push((lon + b).toFixed(3))
    const y = new Date().getUTCFullYear() - 1
    let r = await getJSON(`${API}?latitude=${lats}&longitude=${lons}&daily=river_discharge&start_date=${y}-01-01&end_date=${y}-12-31`)
    if (!Array.isArray(r)) r = [r]
    const mean = (x) => { const v = x.daily.river_discharge.filter((q) => q != null); return v.length ? v.reduce((s, q) => s + q, 0) / v.length : -1 }
    const best = r.map((x) => ({ lat: Number(x.latitude.toFixed(3)), lon: Number(x.longitude.toFixed(3)), flow: mean(x) })).sort((a, b) => b.flow - a.flow)[0]
    if (!(best?.flow > 0)) throw new Error("no river with GloFAS discharge near this place")
    const rad = Math.PI / 180, h = Math.sin(((best.lat - lat) * rad) / 2) ** 2 + Math.cos(lat * rad) * Math.cos(best.lat * rad) * Math.sin(((best.lon - lon) * rad) / 2) ** 2
    return { ...best, km: 6371 * 2 * Math.asin(Math.sqrt(h)) }
}

export { riverCell, annualMaxima, returnLevel, exceedance, rolling, episodes, agree, floodThreshold, floodForecast, assess, replay, rainParams, rainThreshold, assessRain, replayRain, floodHistory, rainHistory, heatParams, longestRun, heatForecast, assessHeat, replayHeat, heatHistory }

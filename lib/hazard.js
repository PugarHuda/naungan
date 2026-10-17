// Flood trigger data: GloFAS v4 (Copernicus EMS) river discharge, served free by Open-Meteo.
// This is the same forecast IFRC Early Action Protocols trigger on (e.g. Uganda Red Cross:
// act when GloFAS gives >= 60-70% probability of a 1-in-5-year flood within the lead time).
const API = "https://flood-api.open-meteo.com/v1/flood"
const EULER = 0.5772156649

async function getJSON(url, tries = 3) {
    for (let i = 1; ; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
            if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
            return await res.json()
        } catch (e) {
            if (i >= tries) throw new Error(`GloFAS request failed: ${e.message}`)
            await new Promise((r) => setTimeout(r, 1000 * i))
        }
    }
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
    const j = await getJSON(`${API}?latitude=${lat}&longitude=${lon}&daily=river_discharge&start_date=1984-01-01&end_date=${end}`)
    const maxima = annualMaxima(j.daily.time, j.daily.river_discharge)
    return { threshold: returnLevel(maxima, returnPeriod), years: maxima.length, cell: [j.latitude, j.longitude] }
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

module.exports = { annualMaxima, returnLevel, exceedance, floodThreshold, floodForecast, assess, replay }

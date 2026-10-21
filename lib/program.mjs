// Program metadata, built one way for every launcher: `scripts/coordinator.js create` and the browser launch
// page both write exactly this JSON on-chain, and the oracles, dashboard and claim app read it back.
// PRESETS are triggers from published Red Cross / Red Crescent Early Action Protocols, with their source.

/** Triggers societies already use; the launch page and `coordinator.js create --preset <id>` start from these. */
export const PRESETS = [
    {
        id: "bdrcs-flood", hazard: "flood", label: "Bangladesh Red Crescent · river flood EAP",
        returnPeriod: 5, leadDays: 15, trigger: 50,
        rule: "GloFAS: at least 50% of members above the 1-in-5-year flood within 15 days (Jamuna at Bahadurabad)",
        source: "https://go-api.ifrc.org/api/downloadfile/88201/MDRBD037eapafr"
    },
    {
        id: "bdrcs-heat", hazard: "heat", label: "Bangladesh Red Crescent · Dhaka heatwave EAP",
        tmax: 38, days: 2, leadDays: 7, trigger: 50,
        rule: "Above 38 °C on 2 or more consecutive days; Naungan counts the share of NOAA GEFS members forecasting it",
        source: "https://www.anticipation-hub.org/news/the-bangladesh-red-crescent-society-activates-its-early-action-protocol-for-heatwaves-in-dhaka"
    },
    {
        id: "urcs-flood", hazard: "flood", label: "Uganda Red Cross · flood EAP",
        returnPeriod: 5, leadDays: 5, trigger: 60,
        rule: "GloFAS: at least 60% of members above the 1-in-5-year flood, 5-day lead (activated 15 Nov 2023)",
        source: "https://www.anticipation-hub.org/Documents/EAPs/EAP_Activation_Uganda_floods_2023.pdf"
    },
    {
        id: "hrc-flood", hazard: "flood", label: "Honduran Red Cross · flood EAP",
        returnPeriod: 10, leadDays: 3, trigger: 50,
        rule: "GloFAS: more than 50% of members above the 1-in-10-year flood within 3 days (activated for Tropical Storm Sara, Nov 2024)",
        source: "https://go-api.ifrc.org/api/DownloadFile/89428/MDRHN020-FR-EAP"
    },
    {
        id: "karachi-heat", hazard: "heat", label: "Karachi heatwave rule (city commissioner, Start Network pilot)",
        tmax: 42, tmin: 30, days: 2, leadDays: 7, trigger: 50,
        rule: "Above 42 °C by day and 30 °C by night, 2 days running. ERA5's 25 km grid runs cool on this coast: check the track record before relying on it",
        source: "https://startnetwork.org/learn-change/news-and-blogs/heatwave-prediction-triggers-release-36K-early-action-karachi"
    }
]

// Which pipelines can watch which hazard: a heat program cannot be "confirmed" by a river forecast.
const FITS = { flood: ["glofas", "rain"], heat: ["heat", "heat-ecmwf"], wind: ["wind", "wind-ecmwf"] }

function inRange(name, v, lo, hi) {
    const n = Number(v)
    if (v === undefined || v === null || v === "" || !Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be a number from ${lo} to ${hi}`)
    return n
}

/**
 * Metadata for createProgram(). Throws with the offending field's name on anything out of range.
 * `oracles` (checksummed addresses) is only needed with `pipelines`, one pipeline per oracle.
 */
export function buildMeta(o) {
    if (typeof o.name !== "string" || !o.name.trim() || o.name.length > 120) throw new Error("name is required (at most 120 characters)")
    const lat = inRange("lat", o.lat, -90, 90), lon = inRange("lon", o.lon, -180, 180)
    const heat = o.hazard === "heat", wind = o.hazard === "wind"
    if (o.hazard && !heat && !wind && o.hazard !== "flood") throw new Error("hazard is flood, heat or wind")
    const meta = wind
        ? {
              name: o.name.trim(),
              hazard: "wind",
              source: "NOAA GEFS daily peak wind gust via Open-Meteo vs ERA5",
              lat,
              lon,
              returnPeriod: inRange("returnPeriod", o.returnPeriod, 1.1, 100),
              leadDays: inRange("leadDays", o.leadDays, 1, 16), // GEFS 0.25 runs 16 days out
              wind: { cells: [[lat, lon]] },
              unit: "% of ensemble members above the return-period gust"
          }
        : heat
        ? {
              name: o.name.trim(),
              hazard: "heat",
              source: "NOAA GEFS daily maximum temperature via Open-Meteo",
              lat,
              lon,
              leadDays: inRange("leadDays", o.leadDays, 1, 16), // GEFS 0.25 runs 16 days out
              heat: {
                  tmax: inRange("tmax", o.tmax, 25, 60),
                  ...(o.tmin != null && o.tmin !== "" && { tmin: inRange("tmin", o.tmin, 10, 45) }),
                  days: inRange("days", o.days, 1, 10),
                  cells: [[lat, lon]]
              },
              unit: "% of ensemble members forecasting a heatwave"
          }
        : {
              name: o.name.trim(),
              hazard: "flood",
              source: "GloFAS v4 river discharge via Open-Meteo",
              lat,
              lon,
              returnPeriod: inRange("returnPeriod", o.returnPeriod, 1.1, 100),
              leadDays: inRange("leadDays", o.leadDays, 1, 30),
              unit: "% of ensemble members above the return-period flood"
          }
    if (o.country != null) {
        if (!/^[A-Z]{2}$/.test(o.country)) throw new Error("country is an ISO 3166 alpha-2 code")
        meta.country = o.country
    }
    if (o.pipelines) {
        // Which forecast each oracle runs, on-chain so anyone can audit that a quorum mixes independent sources.
        const ps = o.pipelines
        if (!Array.isArray(o.oracles) || ps.length !== o.oracles.length || ps.some((x) => !FITS[meta.hazard].includes(x))) throw new Error(`pipelines needs one of ${FITS[meta.hazard].join("|")} per oracle for a ${meta.hazard} program`)
        // Open-Meteo fills ECMWF ENS's first 14 days only (lib/hazard.mjs MODELS).
        if (ps.some((x) => x.endsWith("-ecmwf")) && meta.leadDays > 14) throw new Error("leadDays must be a number from 1 to 14 with an ECMWF oracle")
        meta.pipelines = Object.fromEntries(o.oracles.map((a, i) => [a, ps[i]]))
        if (ps.some((x) => x.endsWith("-ecmwf"))) meta.source += " + ECMWF IFS ENS"
        if (ps.includes("rain")) {
            meta.source += " + NOAA GEFS catchment rainfall vs ERA5"
            meta.rain = {
                returnPeriod: o.rainReturnPeriod != null ? inRange("rainReturnPeriod", o.rainReturnPeriod, 1.1, 100) : meta.returnPeriod,
                cells: (o.rainCells ?? [[lat, lon]]).map(([a, b]) => [inRange("rain cell lat", a, -90, 90), inRange("rain cell lon", b, -180, 180)])
            }
        }
    }
    return meta
}

/** The trigger in words, one wording for the open data, the landing cards and the feed. */
export function ruleText(m, threshold) {
    const ecmwf = Object.values(m.pipelines ?? {}).some((x) => String(x).endsWith("-ecmwf")) ? ", confirmed by ECMWF ENS (2-of-2)" : ""
    if (m.hazard === "wind") return `Cyclone wind: at least ${threshold}% of NOAA GEFS members above the 1-in-${m.wind?.returnPeriod ?? m.returnPeriod}-year gust (ERA5), ${m.leadDays}-day lead${ecmwf}`
    if (m.hazard === "heat") {
        const h = m.heat ?? {}
        return `Heatwave: ${h.days ?? 2}+ days above ${h.tmax ?? 38} °C${h.tmin != null ? `, nights above ${h.tmin} °C` : ""}, at least ${threshold}% of NOAA GEFS members, ${m.leadDays}-day lead${ecmwf}`
    }
    return `River flood: at least ${threshold}% of GloFAS members above the 1-in-${m.returnPeriod}-year flood, ${m.leadDays}-day lead${m.rain ? ", confirmed by NOAA GEFS rainfall (2-of-2)" : ""}`
}

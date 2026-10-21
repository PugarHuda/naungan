// GDACS (gdacs.org, the UN OCHA / European Commission Global Disaster Alert and Coordination System): the alerts
// humanitarian responders watch for floods and tropical cyclones, worldwide, each with a green / orange / red level.
// Set beside a program, they say whether an official alert is out near it now, independently of our oracles.
// Read from the browser (the API allows any origin, needs no key).

const API = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
/** GDACS event types a flood program cares about: floods and tropical cyclones (their rain floods rivers). GDACS has no heatwave alerts. */
export const TYPES = { FL: "Flood", TC: "Tropical cyclone" } as const

export type Alert = { type: keyof typeof TYPES; level: "Green" | "Orange" | "Red"; name: string; from: string; to: string; km: number; current: boolean; url: string }
type Feature = {
    geometry: { coordinates: number[] } // [lon, lat]
    properties: { eventtype: string; alertlevel: string; name: string; fromdate: string; todate: string; iscurrent: string | boolean; affectedcountries?: { iso2: string }[]; url?: { report?: string } }
}

/** Great-circle distance in km. */
export function km(lat1: number, lon1: number, lat2: number, lon2: number) {
    const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
    return Math.round(12742 * Math.asin(Math.sqrt(a)))
}

/**
 * Pure: GDACS features → the flood and cyclone alerts that concern a program at (lat, lon) in country `cc`:
 * those GDACS lists the country as affected by, or whose centre is within `radius` km. Red first, then nearest.
 */
export function relevant(features: Feature[], at: { lat: number; lon: number; cc?: string | null }, radius = 500): Alert[] {
    const rank = { Red: 0, Orange: 1, Green: 2 } as Record<string, number>
    return features
        .filter((f) => f.properties.eventtype in TYPES && f.properties.alertlevel in rank)
        .map((f) => {
            const p = f.properties, [lon, lat] = f.geometry.coordinates
            return { f, a: { type: p.eventtype as Alert["type"], level: p.alertlevel as Alert["level"], name: p.name, from: p.fromdate.slice(0, 10), to: p.todate.slice(0, 10), km: km(at.lat, at.lon, lat, lon), current: p.iscurrent === true || p.iscurrent === "true", url: p.url?.report ?? "https://www.gdacs.org/" } }
        })
        .filter(({ f, a }) => a.km <= radius || (!!at.cc && (f.properties.affectedcountries ?? []).some((c) => c.iso2 === at.cc)))
        .map(({ a }) => a)
        .sort((x, y) => rank[x.level] - rank[y.level] || x.km - y.km)
}

/** Flood and cyclone alerts of the last `days` days that concern a program. */
export async function alertsFor(at: { lat: number; lon: number; cc?: string | null }, days = 30, now = new Date()): Promise<Alert[]> {
    const from = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10), to = now.toISOString().slice(0, 10)
    const all: Feature[] = []
    // 100 events a page; a busy month (monsoon plus a cyclone season) runs past one.
    for (let page = 1; page <= 10; page++) {
        const res = await fetch(`${API}?eventlist=FL;TC&alertlevel=green;orange;red&fromDate=${from}&toDate=${to}&pagenumber=${page}`, { signal: AbortSignal.timeout(15e3) })
        if (!res.ok) throw new Error(`GDACS answered ${res.status}`)
        if (res.status === 204) break // no (more) events: an empty body, not JSON
        const got: Feature[] = (await res.json()).features ?? []
        all.push(...got)
        if (got.length < 100) break
    }
    return relevant(all, at)
}

// WorldPop (University of Southampton): 100 m population counts for every country, 2020, CC BY 4.0. Its stats
// API sums them over a GeoJSON polygon: it answers with a task id, and the sum is ready some seconds later.
// Read from the browser (the API allows any origin, needs no key), to size a program against who lives there.

const API = "https://api.worldpop.org/v1"
type Task = { status: string; error: boolean; error_message: string | null; taskid: string; data?: { total_population: number } }

/** A square `km` either side of (lat, lon), as the GeoJSON the stats API takes. */
export function box(lat: number, lon: number, km: number) {
    const dLat = km / 111.32, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180))
    const ring = [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]].map((p) => p.map((x) => Math.round(x * 1e4) / 1e4))
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] }
}

async function get(url: string): Promise<Task> {
    const r = await fetch(url, { signal: AbortSignal.timeout(45e3) })
    if (!r.ok) throw new Error(`WorldPop answered HTTP ${r.status}`)
    const t: Task = await r.json()
    if (t.error) throw new Error(t.error_message ?? "WorldPop could not sum this area")
    return t
}

/** People living within `km` of (lat, lon) in 2020, by WorldPop. `wait` is the pause between polls (ms). */
export async function peopleNear(lat: number, lon: number, km = 5, wait = 3000): Promise<number> {
    const q = new URLSearchParams({ dataset: "wpgppop", year: "2020", geojson: JSON.stringify(box(lat, lon, km)) })
    let t = await get(`${API}/services/stats?${q}`)
    for (let i = 0; t.status !== "finished"; i++) {
        if (i === 30) throw new Error("WorldPop is still counting; try again later")
        await new Promise((r) => setTimeout(r, wait))
        t = await get(`${API}/tasks/${t.taskid}`)
    }
    if (typeof t.data?.total_population !== "number") throw new Error("WorldPop answered without a population")
    return Math.round(t.data.total_population)
}

// IFRC GO (go.ifrc.org), the Red Cross and Red Crescent's public emergency database: who the national society
// is, and every flood or heatwave the movement responded to in a country (DREF, Emergency Appeal, EAP). Read
// from the browser (the API allows any origin, needs no key), cached in localStorage.

const GO = "https://goadmin.ifrc.org/api/v2"
/** GO disaster types: Flood, Pluvial/Flash Flood, Heat Wave. */
const DTYPES = { flood: [12, 27], heat: [19] } as const

export type Society = { id: number; iso: string; country: string; society: string; url?: string }
export type GoEvent = { id: number; name: string; start: string; affected: number | null; appeals: string[]; url: string }

const cached = async <T>(key: string, days: number, load: () => Promise<T>): Promise<T> => {
    try {
        const c = JSON.parse(localStorage.getItem(key) ?? "null")
        if (c && Date.now() - c.at < days * 864e5) return c.v as T
    } catch {}
    const v = await load()
    try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), v }))
    } catch {}
    return v
}

const getJSON = async (url: string) => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`IFRC GO answered ${r.status}`)
    return r.json()
}

/** The national society of a country (ISO 3166 alpha-2), or null if GO lists none. */
export async function societyOf(cc: string): Promise<Society | null> {
    const all = await cached("naungan-ifrc-countries", 30, async () => {
        const j = await getJSON(`${GO}/country/?limit=400`)
        type Row = { id: number; iso: string | null; name: string; society_name: string; url_ifrc?: string; record_type: number; independent: boolean | null }
        return (j.results as Row[]).filter((c) => c.iso && c.record_type === 1).map((c) => ({ id: c.id, iso: c.iso!, country: c.name, society: c.society_name, url: c.url_ifrc }))
    })
    return all.find((c) => c.iso === cc) ?? null
}

/** Floods (or heatwaves) IFRC GO records for a country, newest first. */
export async function eventsOf(society: Society, hazard: "flood" | "heat"): Promise<GoEvent[]> {
    return cached(`naungan-ifrc-events:${society.id}:${hazard}`, 1, async () => {
        const lists = await Promise.all(
            DTYPES[hazard].map((t) => getJSON(`${GO}/event/?countries__in=${society.id}&dtype=${t}&limit=200&ordering=-disaster_start_date`))
        )
        type Row = { id: number; name: string; disaster_start_date: string; num_affected: number | null; appeals?: { atype_display?: string }[] }
        return lists
            .flatMap((j) => j.results as Row[])
            .map((e) => ({
                id: e.id,
                name: e.name.trim(),
                start: e.disaster_start_date.slice(0, 10),
                affected: e.num_affected,
                appeals: [...new Set((e.appeals ?? []).map((a) => a.atype_display).filter((x): x is string => !!x))],
                url: `https://go.ifrc.org/emergencies/${e.id}`
            }))
            .sort((a, b) => b.start.localeCompare(a.start))
    })
}

/**
 * How a trigger's replayed payouts line up with the responses IFRC actually mounted: each event inside the
 * record's years is "caught" when a payout episode started within `days` of it. This is a country-level
 * comparison (an IFRC flood response may concern another river), so it is context, not a skill score.
 */
export function compare(events: GoEvent[], paid: { start: string; end: string }[], from: string, to: string, days = 30) {
    const t = (d: string) => Date.parse(d + "T00:00:00Z")
    const inRecord = events.filter((e) => e.start >= from && e.start <= to)
    const rows = inRecord.map((e) => ({ ...e, caught: paid.some((p) => t(p.start) - days * 864e5 <= t(e.start) && t(e.start) <= t(p.end) + days * 864e5) }))
    return { rows, caught: rows.filter((r) => r.caught).length, total: rows.length }
}

// The program being drafted, shared by every step of the launch page. Metadata comes from lib/program.mjs
// buildMeta, the same builder `scripts/coordinator.js create` uses, so both write identical JSON on-chain.
import { PRESETS, buildMeta } from "../../../lib/program.mjs"
import { PAIRS } from "../../../lib/hazard.mjs"
import type { Place } from "../shared/place"
import type { Society } from "../shared/ifrc"

export type Hit = { name: string; admin1?: string; country?: string; latitude: number; longitude: number }
export type Cell = { lat: number; lon: number; km: number; flow: number }
export type Preset = (typeof PRESETS)[number]

// ponytail: Naungan's hosted oracle key (the relayer's /health "relayer" address; the GitHub Actions oracle
// posts with it). Hard-coded rather than fetched: a program must name its oracles before it exists.
export const HOSTED_ORACLE = "0x812D262d51eA66C863ecf58B2D5c246f2963d5a1"
// Naungan's second hosted key (GitHub Actions secret RAIN_ORACLE_KEY): it runs the independent pipeline of a 2-of-2 program.
export const SECOND_ORACLE = "0x01029664a642F8e3FF9171e79C9168d6Dc3C1248"

const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const round3 = (x: number) => Math.round(x * 1000) / 1000

export const draft = $state({
    hit: null as Hit | null,
    cell: null as Cell | null,
    snapError: "",
    place: null as Place | null,
    society: null as Society | null,
    people: null as number | null, // WorldPop 2020, within 5 km of the place
    peopleError: "",
    households: "", // planning only: how many households the coordinator means to cover (not on-chain)
    hazard: "flood" as "flood" | "heat" | "wind",
    preset: "urcs-flood",
    returnPeriod: 5,
    leadDays: 5,
    trigger: 60,
    tmax: 38,
    tmin: null as number | null,
    days: 2,
    name: "",
    nameEdited: false,
    amount: "1",
    claimDays: 7,
    seasonEnd: inDays(180),
    oracles: HOSTED_ORACLE,
    quorum: 1,
    second: false // 2-of-2: Naungan's two keys, each on an independent forecast (PAIRS)
})

/** Turn the independent second forecast on or off: Naungan's two hosted keys and quorum 2, or the hosted key alone. */
export function setSecond(on: boolean) {
    draft.second = on
    draft.oracles = on ? `${HOSTED_ORACLE} ${SECOND_ORACLE}` : HOSTED_ORACLE
    draft.quorum = on ? 2 : 1
}

/** Where the oracle reads: the river cell for a flood (once snapped), the place itself for heat or wind. */
export function point(): { lat: number; lon: number } | null {
    if (!draft.hit) return null
    if (draft.hazard === "flood") return draft.cell ? { lat: draft.cell.lat, lon: draft.cell.lon } : null
    return { lat: round3(draft.hit.latitude), lon: round3(draft.hit.longitude) }
}

export function applyPreset(id: string) {
    draft.preset = id
    const p = PRESETS.find((x) => x.id === id) as (Preset & Record<string, unknown>) | undefined
    if (!p) return // custom: keep the fields as they are
    draft.hazard = p.hazard as "flood" | "heat" | "wind"
    draft.leadDays = p.leadDays
    draft.trigger = p.trigger
    if (p.hazard === "flood") draft.returnPeriod = p.returnPeriod as number
    else (draft.tmax = p.tmax as number), (draft.tmin = (p.tmin as number | undefined) ?? null), (draft.days = p.days as number)
}

export const oracleList = () => draft.oracles.split(/[\s,]+/).filter(Boolean)

/** The suggested name, until the coordinator types their own. */
export function suggestName() {
    if (draft.nameEdited || !draft.hit) return
    const where = [draft.hit.admin1 ?? draft.hit.name, draft.place?.name ?? draft.hit.country].filter(Boolean).join(", ")
    draft.name = `${draft.hit.name} ${{ flood: "flood", heat: "heatwave", wind: "cyclone wind" }[draft.hazard]} · ${where}`
}

/** Metadata exactly as it goes on-chain, or the reason it cannot be built yet. */
export function metaOf(): { meta: Record<string, unknown> } | { error: string } {
    const at = point()
    if (!at) return { error: draft.hit ? "Waiting for the river cell…" : "Pick a place first." }
    try {
        const meta = buildMeta({
            name: draft.name,
            hazard: draft.hazard,
            lat: at.lat,
            lon: at.lon,
            country: draft.place?.code,
            returnPeriod: draft.returnPeriod,
            leadDays: draft.leadDays,
            tmax: draft.tmax,
            tmin: draft.tmin,
            days: draft.days,
            ...(draft.second && { oracles: oracleList(), pipelines: PAIRS[draft.hazard] })
        })
        return { meta }
    } catch (e) {
        return { error: (e as Error).message }
    }
}

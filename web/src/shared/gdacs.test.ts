import { describe, expect, it } from "vitest"
import { relevant, km } from "./gdacs"
import features from "./fixtures/gdacs-2026-10-21.json" // real GDACS events of 21 Oct 2026, trimmed to the fields read

const aceh = { lat: 5.575, lon: 95.325, cc: "ID" }

describe("GDACS alerts for a program", () => {
    it("measures great-circle distance", () => {
        expect(km(5.575, 95.325, 5.3677, 100.4617)).toBeGreaterThan(560)
        expect(km(5.575, 95.325, 5.3677, 100.4617)).toBeLessThan(580) // Banda Aceh to Penang, ~570 km
        expect(km(0, 0, 0, 180)).toBe(20015)
    })

    it("keeps floods and cyclones in the program's country or close to it; never droughts", () => {
        const a = relevant(features, aceh)
        expect(a.map((x) => x.name)).toEqual(["Flood in Indonesia"]) // West Sumatra: the same country, ~900 km away
        expect(a[0]).toMatchObject({ type: "FL", level: "Green", current: false, from: "2026-10-09" })
        expect(a[0].url).toMatch(/^https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=1104224/)
        // Drought in Indonesia is listed by GDACS but is not a flood program's concern.
        expect(relevant(features, { ...aceh, cc: "BN" })).toEqual([])
    })

    it("a wider radius adds neighbours' floods, nearest first; red outranks distance", () => {
        expect(relevant(features, aceh, 600).map((x) => [x.name, x.km])).toEqual([["Flood in Thailand", 538], ["Flood in Malaysia", 569], ["Flood in Indonesia", 902]])
        const guam = relevant(features, { lat: 13.44, lon: 144.79, cc: "GU" })
        expect(guam[0]).toMatchObject({ name: "Tropical Cyclone CHAMPI-26", level: "Red", current: true })
    })
})

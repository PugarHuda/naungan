import { afterEach, describe, expect, it, vi } from "vitest"
import { box, peopleNear } from "./worldpop"

afterEach(() => vi.unstubAllGlobals())

describe("WorldPop population near a place", () => {
    it("draws a square of the given half-width, wider in longitude away from the equator", () => {
        const [ring] = box(-19.83, 34.84, 5).features[0].geometry.coordinates
        expect(ring).toHaveLength(5)
        expect(ring[0]).toEqual(ring[4])
        expect(ring[2][1] - ring[0][1]).toBeCloseTo(0.0898, 3) // 10 km of latitude
        expect(ring[2][0] - ring[0][0]).toBeCloseTo(0.0955, 3) // 10 km of longitude at 19.8° S
    })

    it("creates the task, polls it until finished and rounds the sum (answers as WorldPop gave them for Beira)", async () => {
        const asked: string[] = []
        const answers = [
            { status: "created", status_code: 200, error: false, error_message: null, taskid: "37ff9c8b" },
            { status: "started", status_code: 200, error: false, error_message: null, taskid: "37ff9c8b" },
            { status: "finished", status_code: 200, error: false, error_message: null, taskid: "37ff9c8b", data: { total_population: 153533.06 } }
        ]
        vi.stubGlobal("fetch", async (u: string) => (asked.push(u), new Response(JSON.stringify(answers.shift()))))
        expect(await peopleNear(-19.83, 34.84, 5, 0)).toBe(153533)
        expect(asked[0]).toMatch(/^https:\/\/api\.worldpop\.org\/v1\/services\/stats\?dataset=wpgppop&year=2020&geojson=/)
        expect(JSON.parse(new URL(asked[0]).searchParams.get("geojson")!).features[0].geometry.type).toBe("Polygon")
        expect(asked.slice(1)).toEqual(["https://api.worldpop.org/v1/tasks/37ff9c8b", "https://api.worldpop.org/v1/tasks/37ff9c8b"])
    })

    it("says why when WorldPop refuses or fails", async () => {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: "finished", error: true, error_message: "Polygon outside dataset", taskid: "x" })))
        await expect(peopleNear(0, -160, 5, 0)).rejects.toThrow("Polygon outside dataset")
        vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }))
        await expect(peopleNear(0, 0, 5, 0)).rejects.toThrow("WorldPop answered HTTP 503")
    })
})

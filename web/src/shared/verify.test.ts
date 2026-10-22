import { describe, expect, it } from "vitest"
import { compareEvidence } from "./verify.mjs"

// Program #9's report of 22 Oct 2026, 01:35 UTC, and the same run recomputed in a browser four hours later.
const posted = "NOAA GEFS 0.25 wind gusts via Open-Meteo | mean of 1 cells | run 2026-10-21T18Z | lead 5d | 1-in-10y gust 112 km/h (Gumbel, 42y ERA5) | 0/31 members exceed | median strongest gust 23 km/h"

describe("in-browser oracle audit: comparing evidence", () => {
    it("identical evidence is a match", () => {
        expect(compareEvidence(posted, posted)).toEqual({ verdict: "identical" })
    })

    it("only the informational median moved (Open-Meteo revised the run): the trigger's inputs match, and the moved figure is named", () => {
        expect(compareEvidence(posted, posted.replace("23 km/h", "22 km/h"))).toEqual({ verdict: "decision", posted: "median strongest gust 23 km/h", now: "median strongest gust 22 km/h" })
    })

    it("anything the trigger decides on differs: a mismatch", () => {
        for (const changed of [posted.replace("0/31 members", "3/31 members"), posted.replace("112 km/h", "98 km/h"), posted.replace("T18Z", "T12Z"), posted.replace(" | median strongest gust 23 km/h", "")])
            expect(compareEvidence(posted, changed).verdict).toBe("different")
    })
})

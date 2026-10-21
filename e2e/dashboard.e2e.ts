import { test, expect } from "./fixtures"

test("dashboard: program 1 totals and ledger", async ({ page, check }) => {
    await page.goto("/dashboard.html?program=1")
    await expect(page.locator(".big", { hasText: "USDC funded" }).first()).toHaveText(/\d[\d.,]* USDC funded/)
    await expect(page.locator('[role="log"] .row').first()).toBeVisible() // the ledger rebuilt from chain events
    await check(page)
})

test("dashboard: every payout of program 1 re-verifies in the browser @desktop", async ({ page }) => {
    await page.goto("/dashboard.html?program=1")
    await expect(page.locator('[role="log"] .row').first()).toBeVisible() // the audit works from the loaded event history
    await page.getByRole("button", { name: "Verify every payout" }).click()
    // Program 1's 3 enrolled households have all been paid; each Groth16 proof is re-checked here with snarkjs.
    await expect(page.locator("b", { hasText: /^3 of 3$/ })).toBeVisible({ timeout: 90_000 })
})

test("dashboard: heat program draws the temperature chart", async ({ page, check }) => {
    await page.goto("/dashboard.html?program=6")
    await expect(page.locator("h1")).toHaveText(/heatwave/i)
    await expect(page.locator('svg[aria-label^="Daily maximum temperature"] path').first()).toBeVisible()
    await check(page)
})

test("dashboard: the program picker updates the address", async ({ page }) => {
    await page.goto("/dashboard.html?program=1")
    const picker = page.locator("select#prog")
    await expect(picker.locator('option[value="8"]')).toHaveCount(1)
    await picker.selectOption("8")
    await expect(page).toHaveURL(/\?program=8$/)
    await expect(page.locator("h1")).toHaveText(/Aguán/)
})

test("dashboard: with the free indexer down, the history comes from the open-data API, not thousands of RPC windows @desktop", async ({ page }) => {
    await page.route(/blockscout\.com/, (r) => r.abort()) // the indexer is unreachable
    const api = page.waitForResponse((r) => r.url().includes("/api/programs?format=events"), { timeout: 60e3 })
    await page.goto("/dashboard.html?program=1")
    expect((await api).status()).toBe(200)
    // Program 1's whole history: funding, enrollment, the trigger and its payouts, rebuilt from the API's values.
    const rows = page.locator('[role="log"] .row')
    await expect(rows.first()).toBeVisible({ timeout: 30e3 })
    expect(await rows.count()).toBeGreaterThanOrEqual(5)
    await expect(page.locator('[role="log"]')).toContainText(/Claimed|claimed|paid/i)
})

test("dashboard: official GDACS alerts near the program, read live; a heat program says GDACS has none for heat", async ({ page, check }) => {
    await page.goto("/dashboard?program=8") // Aguán river, Honduras: Central America's flood and cyclone season
    const panel = page.locator("article", { has: page.getByRole("heading", { name: "Official alerts nearby" }) })
    await panel.scrollIntoViewIfNeeded()
    const status = panel.getByRole("status")
    await expect(status).toHaveText(/active|No GDACS flood or cyclone alert near this program|GDACS is unavailable right now \(.+\)/, { timeout: 30e3 })
    if (await panel.locator("ul.go li").count()) {
        // Each listed alert links its official GDACS report and says how far it is.
        await expect(panel.locator("ul.go li a").first()).toHaveAttribute("href", /^https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=\d+/)
        await expect(panel.locator("ul.go li .meta").first()).toHaveText(/(Flood|Tropical cyclone) · (Green|Orange|Red) alert · [\d,]+ km away/)
    }
    await check(page)
    await page.goto("/dashboard?program=6") // Dhaka heatwave
    const heat = page.locator("article", { has: page.getByRole("heading", { name: "Official alerts nearby" }) })
    await heat.scrollIntoViewIfNeeded()
    await expect(heat.getByRole("status")).toHaveText(/GDACS issues no heatwave alerts/)
})

test("dashboard: cyclone wind program (#9, Tacloban) draws the gust forecast, recomputes its oracle and replays the typhoons it would have paid on @desktop", async ({ page, check }) => {
    await page.goto("/dashboard?program=9")
    await expect(page.locator("h1")).toHaveText("Tacloban typhoon wind")
    await expect(page.getByText(/No cyclone expected yet|A cyclone is forecast/)).toBeVisible()
    await expect(page.locator('svg[aria-label^="Daily peak wind gust forecast"] path').first()).toBeVisible()
    await expect(page.locator("figcaption")).toContainText(/1-in-10-year gust in ERA5/)
    // The oracle's report recomputed from Open-Meteo in this browser: same code, same GEFS run if it is today's.
    const oracle = page.locator(".oracle", { hasText: "Peak wind gusts (NOAA GEFS)" })
    await oracle.getByRole("button", { name: "Recompute in my browser" }).click()
    await expect(oracle.getByRole("status")).toHaveText(/✓ Matches|Not comparable with the posted/, { timeout: 90_000 })
    await page.getByRole("button", { name: "Replay 40 years" }).click()
    const record = page.locator("article", { has: page.getByRole("heading", { name: "Would it have paid before?" }) })
    await expect(record.getByText(/8 Nov 2013, gusts 12\d km\/h/)).toBeVisible({ timeout: 90_000 }) // Haiyan
    await expect(record.locator("p.fine")).toContainText("not a storm category")
    await check(page)
})

test("dashboard: a 2-of-2 cyclone program (#10, Beira) shows both independent forecasts and recomputes the ECMWF one @desktop", async ({ page }) => {
    await page.goto("/dashboard?program=10")
    await expect(page.locator("h1")).toHaveText("Beira cyclone wind")
    await expect(page.locator(".oracle", { hasText: "Peak wind gusts (NOAA GEFS)" })).toBeVisible()
    const ecmwf = page.locator(".oracle", { hasText: "Peak wind gusts (ECMWF ENS)" })
    await expect(ecmwf.locator(".evidence")).toHaveText(/^ECMWF IFS 0\.25 ENS wind gusts via Open-Meteo .*\/51 members exceed/, { useInnerText: false })
    await ecmwf.getByRole("button", { name: "Recompute in my browser" }).click()
    await expect(ecmwf.getByRole("status")).toHaveText(/✓ Matches|Not comparable with the posted/, { timeout: 90_000 })
    await expect(page.getByText(/of 2 oracles at the trigger\. Claims open when 2 agree\./)).toBeVisible()
})

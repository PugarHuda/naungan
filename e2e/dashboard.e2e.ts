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

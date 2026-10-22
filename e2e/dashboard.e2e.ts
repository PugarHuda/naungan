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

test("dashboard: the whole history comes from a wide-range RPC in one request, before the rate-limited indexer is asked @desktop", async ({ page }) => {
    const asked: string[] = []
    page.on("request", (r) => asked.push(r.url()))
    await page.goto("/dashboard.html?program=1")
    const rows = page.locator('[role="log"] .row')
    await expect(rows.first()).toBeVisible({ timeout: 30e3 })
    expect(await rows.count()).toBeGreaterThanOrEqual(5)
    expect(asked.some((u) => u.startsWith("https://base-sepolia.gateway.tenderly.co"))).toBe(true)
    expect(asked.some((u) => /blockscout\.com\/api\?module=logs/.test(u))).toBe(false)
})

test("dashboard: with the wide-range RPCs and the free indexer down, the history comes from the open-data API, not thousands of RPC windows @desktop", async ({ page }) => {
    await page.route(/blockscout\.com|gateway\.tenderly\.co|publicnode\.com/, (r) => r.abort()) // every history source but our own is unreachable
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

test("dashboard: what households say, read from Semaphore's on-chain proofs for this program's group and feedback scope", async ({ page, check }) => {
    const asked: string[] = []
    page.on("request", (r) => r.method() === "POST" && asked.push(r.postData() ?? ""))
    await page.goto("/dashboard?program=3")
    const panel = page.locator("#feedback")
    await panel.scrollIntoViewIfNeeded()
    await expect(panel.getByRole("status")).toHaveText(/of 5 from \d+ household|No household has rated this program yet/, { timeout: 45e3 })
    await expect(panel).toContainText(/Read from (base-sepolia\.gateway\.tenderly\.co|base-sepolia-rpc\.publicnode\.com|open-data API)/)
    // The query names Semaphore's ProofValidated, the program's group and its feedback scope as topics.
    expect(asked.some((b) => b.includes('"eth_getLogs"') && /"address":"0x6e5Dd641faea7772baA3F83B30a643EC17d4180d"/i.test(b))).toBe(true)
    await check(page)
})

test("dashboard: running costs measured from real transactions and priced on Base mainnet (gas price, L1 fee, Chainlink ETH/USD)", async ({ page, check }) => {
    await page.goto("/dashboard?program=2")
    const panel = page.locator("#costs")
    await expect(panel.getByRole("row").filter({ hasText: "A household's claim" })).toBeVisible({ timeout: 90_000 })
    // A claim verifies a Groth16 proof on-chain: hundreds of thousands of gas, and still well under a cent on Base.
    const claim = panel.getByRole("row").filter({ hasText: "A household's claim" }).getByRole("cell")
    expect(Number((await claim.nth(1).textContent())!.replace(/,/g, ""))).toBeGreaterThan(200_000)
    await expect(claim.nth(2)).toHaveText(/^\$0\.00\d/)
    await expect(panel.getByRole("row").filter({ hasText: "An oracle report" })).toBeVisible()
    await expect(panel.locator(".big")).toContainText(/^\$[\d.]+ a season for this program$/)
    await expect(panel.locator(".season")).toHaveText(/^1 oracle reporting for a year .+ and enrolling and paying its 3 households .+% of the aid it pays\. At 1,000 households, \$[\d.,]+ in all, \$0\.0\d+ a household\.$/)
    await expect(panel).toContainText(/Chainlink's ETH \/ USD feed on Base \(updated 20\d\d-/)
    await check(page)
})

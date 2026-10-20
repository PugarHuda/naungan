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

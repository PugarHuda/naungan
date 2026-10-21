import { test, expect, pickPlace } from "./fixtures"
import { PRESETS } from "../lib/program.mjs"

test("launch: every preset shows its published source and fills the trigger", async ({ page, check }) => {
    await page.goto("/launch.html")
    const preset = page.locator("select#preset")
    await expect(preset.locator("option")).toHaveCount(PRESETS.length + 1) // + custom
    for (const p of PRESETS) {
        await preset.selectOption(p.id)
        await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("href", p.source)
    }
    await preset.selectOption("bdrcs-heat")
    await expect(page.getByLabel("Heatwave")).toBeChecked()
    await expect(page.getByLabel("Day temperature above (°C)")).toHaveValue("38")
    await expect(page.getByLabel("Consecutive days")).toHaveValue("2")
    await expect(page.getByLabel("Lead time (days)")).toHaveValue("7")
    await expect(page.getByLabel("Trigger (% of forecast members)")).toHaveValue("50")
    await check(page)
})

test("launch: an out-of-range trigger is refused, naming the field, before any wallet opens", async ({ page }) => {
    await page.goto("/launch.html")
    await page.locator("select#preset").selectOption("bdrcs-heat") // heat: no river snap needed
    test.skip(!(await pickPlace(page, "Dhaka")), "Open-Meteo's geocoder did not answer this runner (the page said so)")
    await page.getByLabel("Lead time (days)").fill("40") // NOAA GEFS runs 16 days out
    const create = page.getByRole("button", { name: "Connect wallet and create program" })
    await expect(page.locator("p.fine", { hasText: "leadDays must be a number from 1 to 16" })).toBeVisible()
    await expect(create).toBeDisabled()
    // Back in range, the only thing missing is a wallet (none in CI): the page says so instead of failing.
    await page.getByLabel("Lead time (days)").fill("7")
    await expect(create).toBeEnabled()
    await create.click()
    await expect(page.getByRole("status")).toHaveText(/No browser wallet found/)
})

test("launch: a cyclone wind trigger asks for the gust's return period and explains why it is not a storm category @desktop", async ({ page, check }) => {
    await page.goto("/launch")
    await page.getByLabel("Cyclone wind").check()
    await expect(page.getByLabel("Gust size (1-in-N years)")).toHaveValue("10")
    await expect(page.getByLabel("Lead time (days)")).toHaveAttribute("max", "16") // NOAA GEFS runs 16 days out
    await expect(page.locator("select#preset")).toHaveValue("") // no Red Cross preset is a gust rule: a custom trigger
    await expect(page.getByText(/ERA5 gives Haiyan 124 km\/h at Tacloban/)).toBeVisible()
    await check(page)
})

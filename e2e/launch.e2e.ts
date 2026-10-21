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

test("launch: a second, independent forecast makes the program 2-of-2 with Naungan's two keys, and ECMWF's 14-day limit is enforced @desktop", async ({ page }) => {
    await page.goto("/launch")
    await page.getByLabel("Cyclone wind").check()
    await page.getByLabel(/Require a second, independent forecast/).check()
    await expect(page.getByText(/both agree: NOAA GEFS gusts and ECMWF ENS gusts/)).toBeVisible()
    await expect(page.getByText(/quorum 2\./)).toContainText("0x812D262d51eA66C863ecf58B2D5c246f2963d5a1, 0x01029664a642F8e3FF9171e79C9168d6Dc3C1248")
    test.skip(!(await pickPlace(page, "Beira")), "Open-Meteo's geocoder did not answer this runner (the page said so)")
    await page.locator("summary", { hasText: "Metadata written on-chain" }).click()
    await expect(page.locator("pre.evidence")).toContainText('"0x01029664a642F8e3FF9171e79C9168d6Dc3C1248": "wind-ecmwf"')
    await page.getByLabel("Lead time (days)").fill("15")
    await expect(page.locator("p.fine", { hasText: "leadDays must be a number from 1 to 14 with an ECMWF oracle" })).toBeVisible()
})

test("launch: the place card counts the people living around it (WorldPop) and the terms turn households into the funding needed @desktop", async ({ page, check }) => {
    await page.goto("/launch")
    await page.getByLabel("Cyclone wind").check()
    test.skip(!(await pickPlace(page, "Beira")), "Open-Meteo's geocoder did not answer this runner (the page said so)")
    // WorldPop's API is read live from the browser, under the page's CSP; when it is down, the page says so in words.
    await expect(page.locator("#people")).toHaveText(/About [\d,]{5,} people live within 5 km \(WorldPop 2020|The population count is unavailable right now \(.+\)/, { timeout: 120e3 })
    await page.getByLabel("Per household (USDC)").fill("0.5")
    await page.getByLabel("Households to cover").fill("1200")
    await expect(page.locator("#budget")).toContainText("Funding needed to pay them all: 600 USDC")
    if (/About/.test((await page.locator("#people").textContent())!)) await expect(page.locator("#budget")).toContainText(/for 1,200 households among the about [\d,]+ people within 5 km/)
    await check(page)
})

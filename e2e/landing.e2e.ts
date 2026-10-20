import { test, expect } from "./fixtures"

test("landing: every live program, the forecast chart, cards link to the dashboard", async ({ page, check }) => {
    await page.goto("/")
    const sum = page.locator("#worldSum")
    await expect(sum).toHaveText(/\d+ programs in [1-9]\d* countries on [1-9]\d* continents/)
    const [, programs, countries, continents] = (await sum.textContent())!.match(/(\d+) programs in (\d+) countries on (\d+) continents/)!.map(Number)
    expect(programs).toBeGreaterThanOrEqual(8)
    expect(countries).toBeGreaterThanOrEqual(4) // Indonesia, Bangladesh, Uganda, Honduras
    expect(continents).toBeGreaterThanOrEqual(3)

    // The featured river's forecast: ensemble band + median. Open-Meteo's free tier rate-limits shared CI runners;
    // then the page must say so plainly instead of drawing nothing, and the report notes it.
    const chart = page.locator("svg#chart path"), limited = page.getByText(/Forecast unavailable right now \(.*429\)/)
    await expect(chart.first().or(limited)).toBeVisible()
    if (await limited.isVisible()) test.info().annotations.push({ type: "rate-limited", description: "Open-Meteo answered 429; chart not drawn" })
    else await expect(chart).toHaveCount(2)

    const cards = page.locator("#programs ul.world a")
    await expect(cards).toHaveCount(programs)
    for (const href of await cards.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) expect(href).toMatch(/^dashboard\.html\?program=\d+$/)
    await check(page)
})

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
    // or does not answer; then the page must say so plainly instead of drawing nothing, and the report notes it.
    // lib/hazard.mjs tries three times, 20 s each, before it gives up.
    const chart = page.locator("svg#chart path"), limited = page.getByText(/Forecast unavailable right now \(.*(429|timed out|aborted)/)
    await expect(chart.first().or(limited)).toBeVisible({ timeout: 75e3 })
    if (await limited.isVisible()) test.info().annotations.push({ type: "forecast-unavailable", description: (await limited.textContent())! })
    else await expect(chart).toHaveCount(2)

    const cards = page.locator("#programs ul.world a")
    await expect(cards).toHaveCount(programs)
    for (const href of await cards.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) expect(href).toMatch(/^dashboard\.html\?program=\d+$/)
    await check(page)
})

test("search engines find the open data: schema.org Dataset whose every download answers, robots.txt, sitemap", async ({ page, request }) => {
    await page.goto("/")
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)
    expect(ld["@type"]).toBe("Dataset")
    expect(ld.description.length).toBeGreaterThanOrEqual(50) // Google's minimum
    expect(ld.distribution.length).toBeGreaterThanOrEqual(6)
    // Production, since the local preview serves no API: each listed download is live and what it says it is.
    for (const d of ld.distribution) {
        const res = await request.get(d.contentUrl, { timeout: 60e3 })
        expect(res.status(), d.contentUrl).toBe(200)
        expect(res.headers()["content-type"], d.contentUrl).toContain(d.encodingFormat)
    }
    expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/relay[\s\S]*Sitemap: https:\/\/naungan\.vercel\.app\/sitemap\.xml/)
    const urls = [...(await (await request.get("/sitemap.xml")).text()).matchAll(/<loc>https:\/\/naungan\.vercel\.app(\/[^<]*)<\/loc>/g)].map((m) => m[1])
    expect(urls).toContain("/dashboard.html")
    for (const u of urls) expect((await request.get(u)).status(), u).toBe(200)
})

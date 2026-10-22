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
    // or does not answer (GitHub's shared runners are often refused outright: "Failed to fetch"); then the page must say
    // so plainly instead of drawing nothing, and the report notes it. A page gives up after two tries of 10 s.
    const chart = page.locator("svg#chart path"), limited = page.getByText(/Forecast unavailable right now \(.+\)/)
    await expect(chart.first().or(limited)).toBeVisible({ timeout: 45e3 })
    if (await limited.isVisible()) test.info().annotations.push({ type: "forecast-unavailable", description: (await limited.textContent())! })
    else await expect(chart).toHaveCount(2)

    const cards = page.locator("#programs ul.world a")
    await expect(cards).toHaveCount(programs)
    for (const href of await cards.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) expect(href).toMatch(/^dashboard\?program=\d+$/)
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
    expect(urls).toContain("/dashboard")
    for (const u of urls) expect((await request.get(u)).status(), u).toBe(200)
})

test("hero: the phone never covers the headline, text or buttons, and the menu stays on one line, at every desktop width @desktop", async ({ page }) => {
    await page.goto("/")
    for (let w = 901; w <= 1960; w += 20) {
        await page.setViewportSize({ width: w, height: 900 })
        const r = await page.evaluate(() => {
            const els = [...document.querySelectorAll(".hero .device, .hero .chip, .hero .ctas .btn, .hero .lede, .hero h1, .hero .eyebrow")]
            const hits: string[] = []
            for (let i = 0; i < els.length; i++)
                for (let j = i + 1; j < els.length; j++) {
                    const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect()
                    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) hits.push(`${els[i].className} × ${els[j].textContent!.trim().slice(0, 24)}`)
                }
            const nav = document.querySelector("nav .wrap")!
            return { hits, wrapped: [...document.querySelectorAll("nav a")].filter((a) => a.getBoundingClientRect().height > 40).map((a) => a.textContent), navOverflow: nav.scrollWidth - nav.clientWidth }
        })
        expect(r, `${w} px`).toEqual({ hits: [], wrapped: [], navOverflow: 0 })
    }
})

test("landing: the river chart comes from the site's edge-cached forecast, so a room on one network shares one Open-Meteo request @desktop", async ({ request }) => {
    // Production: vite preview serves no functions. Coordinates come from the chain, never the request.
    expect((await request.get("https://naungan.vercel.app/api/forecast?program=4&lat=0")).status()).toBe(400)
    expect((await request.get("https://naungan.vercel.app/api/forecast?program=6")).status()).toBe(404) // a heatwave program has no river
    const res = await request.get("https://naungan.vercel.app/api/forecast?program=4", { timeout: 60e3 })
    expect(res.status()).toBe(200)
    // Served from the CDN after the first visitor: Vercel keeps s-maxage for itself and reports the cache in x-vercel-cache.
    expect((await request.get("https://naungan.vercel.app/api/forecast?program=4")).headers()["x-vercel-cache"]).toMatch(/HIT|STALE/)
    const f = await res.json()
    expect(f.time).toHaveLength(30)
    expect(f.threshold).toBeGreaterThan(100) // Krueng Aceh's 1-in-5-year flood, in m3/s, from the oracles' own code
    expect(f.source).toMatch(/^https:\/\/flood-api\.open-meteo\.com\/v1\/flood\?latitude=5\.\d+&longitude=95\.\d+/)
})

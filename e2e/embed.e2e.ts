import { test, expect } from "./fixtures"

// The partner page is fulfilled by the test, so Chrome sees no address for it and its Local Network Access check
// refuses to let it frame localhost; in production both sides are public sites, where that check never applies.
// vite preview has no serverless functions: /api/programs is answered by the live production endpoint (real chain data).
const LIVE = "https://naungan.vercel.app/api/programs"
test.use({ launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] } })

test("embed: a partner site on another origin shows a program's live status in an iframe", async ({ page, context, check }) => {
    await context.route("**/api/programs", async (r) => r.fulfill({ response: await r.fetch({ url: LIVE }) }))
    await context.route("http://partner.example/", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><title>Partner</title><h1>Our programs</h1><iframe title="Naungan program #7" src="http://localhost:4173/embed.html?program=7" width="520" height="360"></iframe>` }))
    await page.goto("http://partner.example/")
    const f = page.frameLocator('iframe[title="Naungan program #7"]')
    await expect(f.getByRole("heading", { level: 1 })).toContainText("Mpologoma")
    await expect(f.getByText(/Watching the forecast until|claims open until|Claims closed/)).toBeVisible()
    await expect(f.getByText("Households paid")).toBeVisible()
    await expect(f.getByRole("link", { name: /Verify every payout/ })).toHaveAttribute("href", /dashboard\.html\?program=7$/)

    await page.goto("/embed.html?program=7&theme=dark")
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mpologoma")
    await check(page)
    await page.goto("/embed.html?program=999")
    await expect(page.getByText("There is no program #999.")).toBeVisible()
})

test("embed: only the widget may be framed; every other page refuses @desktop", async ({ request }) => {
    const embed = (await request.get("/embed.html")).headers()["content-security-policy"]
    expect(embed).toContain("frame-ancestors *")
    expect(embed).toMatch(/connect-src 'self'(;|$)/) // the widget talks to nothing but our own API
    for (const p of ["/", "/dashboard.html", "/claim.html", "/launch.html"]) expect((await request.get(p)).headers()["content-security-policy"], p).toContain("frame-ancestors 'none'")
})

test("dashboard: the embed code points at this program @desktop", async ({ page }) => {
    await page.goto("/dashboard.html?program=7")
    await page.getByText("Embed this program on your site").click()
    await expect(page.getByRole("textbox", { name: "Embed code" })).toHaveValue(/<iframe src="http:\/\/localhost:4173\/embed\.html\?program=7"/)
})

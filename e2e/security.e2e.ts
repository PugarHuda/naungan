import { test, expect, pickPlace } from "./fixtures"

// The preview serves vercel.json's headers (vite.config.mjs), so this checks the policy production sends.
test("security headers: present, and the CSP allows every host the pages actually fetch @desktop", async ({ page, request }) => {
    const res = await request.get("/claim")
    const h = res.headers()
    expect(h["x-content-type-options"]).toBe("nosniff")
    expect(h["referrer-policy"]).toBe("no-referrer") // a claim card's link never leaks to another site
    expect(h["permissions-policy"]).toContain("camera=(self)")
    const csp = h["content-security-policy"]
    expect(csp).toBeTruthy()
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/) // no CDN scripts, no eval: only snarkjs's WebAssembly
    const connect = csp.match(/connect-src ([^;]+)/)![1].split(/\s+/)

    // Walk every page through its data loads and collect the origins it fetches.
    const fetched = new Set<string>()
    page.on("request", (r) => {
        const u = new URL(r.url())
        if (["fetch", "xhr"].includes(r.resourceType()) && u.hostname !== "localhost") fetched.add(u.origin)
    })
    await page.goto("/")
    await expect(page.locator("#worldSum")).toHaveText(/\d+ programs in [1-9]/)
    await page.goto("/dashboard.html?program=5")
    await expect(page.locator('[role="log"] .row').first()).toBeVisible()
    await page.goto("/claim.html#join=7")
    await expect(page.locator(".idr").first()).toContainText("USh")
    await page.goto("/launch.html")
    // Without a place (geocoder refused this runner) the society lookup never runs; every origin fetched so far is still checked.
    if (await pickPlace(page, "Butaleja")) await expect(page.getByText(/to the main channel|Uganda Red Cross/).first()).toBeVisible()

    expect(fetched.size).toBeGreaterThanOrEqual(5) // RPC, indexer, Open-Meteo, exchange rates, IFRC GO…
    expect([...fetched].filter((o) => !connect.includes(o)), "origins fetched but missing from connect-src").toEqual([])
})

test("security.txt (RFC 9116) and link previews on every page @desktop", async ({ request }) => {
    const txt = await (await request.get("/.well-known/security.txt")).text()
    expect(txt).toMatch(/^Contact: https:\/\//m)
    const expires = new Date(txt.match(/^Expires: (.+)$/m)![1])
    expect(expires.getTime() - Date.now()).toBeGreaterThan(30 * 864e5) // renew it before it lapses
    for (const p of ["/", "/dashboard", "/claim", "/launch"]) {
        const html = await (await request.get(p)).text()
        for (const m of ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:image" content="https://'])
            expect(html, `${p} ${m}`).toContain(m)
    }
})

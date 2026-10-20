import { test, expect } from "./fixtures"

// The preview serves vercel.json's headers (vite.config.mjs), so this checks the policy production sends.
test("security headers: present, and the CSP allows every host the pages actually fetch @desktop", async ({ page, request }) => {
    const res = await request.get("/claim.html")
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
    await page.locator("#place").fill("Butaleja")
    await page.getByRole("button", { name: "Search" }).click()
    await page.getByRole("list", { name: "Matching places" }).getByRole("button").first().click()
    await expect(page.getByText(/to the main channel|Uganda Red Cross/).first()).toBeVisible()

    expect(fetched.size).toBeGreaterThanOrEqual(5) // RPC, indexer, Open-Meteo, BigDataCloud, exchange rates…
    expect([...fetched].filter((o) => !connect.includes(o)), "origins fetched but missing from connect-src").toEqual([])
})

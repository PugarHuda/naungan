import { test, expect } from "./fixtures"

// The judges' demo card for program 2 (claims open). Claim is only ever pressed with /relay fulfilled locally.
const DEMO_CARD = "/claim.html#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D"

test("claim: no card shows the paste box, and a wrong code is refused @phone", async ({ page, check }) => {
    await page.goto("/claim.html")
    const box = page.locator("textarea#code")
    await expect(box).toBeVisible()
    await box.fill("hello")
    await page.getByRole("button", { name: "Open card" }).click()
    expect(await box.evaluate((el: HTMLTextAreaElement) => el.validationMessage)).toMatch(/not a Naungan card code/)
    await check(page)
})

for (const [pid, lang, money] of [["6", "bn", "৳"], ["8", "es", "L"], ["7", "sw", "USh"]] as const) {
    test(`claim: registering for program ${pid} opens in ${lang} with ${money} amounts @phone`, async ({ page, check }) => {
        await page.goto(`/claim.html#join=${pid}`)
        await expect(page.locator("html")).toHaveAttribute("lang", lang)
        await expect(page.locator(".idr").first()).toContainText(money)
        await expect(page).not.toHaveURL(/#/) // the fragment never stays in the address bar
        await check(page)
    })
}

test("claim: a chosen language survives a reload @phone", async ({ page }) => {
    await page.goto("/claim.html#join=6")
    await expect(page.locator("html")).toHaveAttribute("lang", "bn")
    await page.locator("select#lang").selectOption("en")
    await expect(page.locator("h1")).toHaveText("Claim your support")
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect(page.locator("h1")).toHaveText("Claim your support")
})

test("claim: the phone proves membership under the real CSP; the claim is queued, never sent @phone", async ({ page }) => {
    let body: { programId: string; proof: { points: unknown[]; scope: string; nullifier: string; message: string } } | undefined
    await page.route("**/relay", async (r) => {
        body = r.request().postDataJSON()
        await r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"e2e: relayer stubbed"}' })
    })
    await page.goto(DEMO_CARD)
    await page.getByRole("button", { name: /^(Claim now|Klaim sekarang)$/ }).click()
    await expect.poll(() => body, { timeout: 120_000 }).toBeTruthy()
    expect(body!.programId).toBe("2")
    expect(body!.proof.points).toHaveLength(8)
    expect(String(body!.proof.scope)).toBe("2")
    expect(BigInt(body!.proof.message)).toBeGreaterThan(0n) // the payout address, bound inside the proof
    await expect(page.locator("#queued")).toBeVisible() // kept on the phone for a retry, as a 503 should be
})

test.describe("offline", () => {
    test.use({ serviceWorkers: "allow" }) // nothing here presses Claim
    test("claim: a registration page reopens with no signal @phone", async ({ page, context }) => {
        await page.goto("/claim.html#join=6")
        await expect(page.locator("html")).toHaveAttribute("lang", "bn")
        await page.evaluate(() => navigator.serviceWorker.ready)
        await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("naungan-shell-")))).toBe(true)
        await page.waitForTimeout(1500) // let the shell precache finish writing
        await context.setOffline(true)
        await page.reload()
        await expect(page.locator("html")).toHaveAttribute("lang", "bn")
        await expect(page.locator("h1")).toHaveText("আপনার সহায়তা দাবি করুন")
        await expect(page.locator("#joinCode, svg").first()).toBeVisible() // the registration code, from this phone
    })
})

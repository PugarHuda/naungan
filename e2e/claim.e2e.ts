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

for (const [pid, lang, money, h1] of [["6", "bn", "BDT", "আপনার সহায়তা দাবি করুন"], ["8", "es", "HNL", "Reclame su apoyo"], ["7", "sw", "UGX", "Pokea msaada wako"], ["10", "pt", "MZN", "Receba o seu apoio"], ["9", "fil", "₱", "Kunin ang iyong ayuda"]] as const) {
    test(`claim: registering for program ${pid} opens in English with ${money} amounts, and in ${lang} when the household picks it @phone`, async ({ page, check }) => {
        await page.goto(`/claim.html#join=${pid}`)
        await expect(page.locator("html")).toHaveAttribute("lang", "en")
        await expect(page.locator(".idr").first()).toContainText(money)
        await page.locator("select#lang").selectOption(lang)
        await expect(page.locator("html")).toHaveAttribute("lang", lang)
        await expect(page.locator("h1")).toHaveText(h1)
        await expect(page).not.toHaveURL(/#/) // the fragment never stays in the address bar
        await check(page)
    })
}

test("claim: a chosen language survives a reload @phone", async ({ page }) => {
    await page.goto("/claim.html#join=6")
    await expect(page.locator("h1")).toHaveText("Claim your support")
    await page.locator("select#lang").selectOption("bn")
    await expect(page.locator("h1")).toHaveText("আপনার সহায়তা দাবি করুন")
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "bn")
    await expect(page.locator("h1")).toHaveText("আপনার সহায়তা দাবি করুন")
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
        await page.locator("select#lang").selectOption("bn") // the household's choice is kept offline too
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

// An e2e household enrolled in program 3 (watching: trigger not fired), so the card offers flood alerts. Never claims.
const WATCH_CARD = "/claim.html#p=3&id=do3gruhiVV2vHe75Zl4%2BFoQ297YKA5q6inXoHvDLn2A%3D"

test.describe("iPhone alerts", () => {
    // Safari on iOS has no PushManager outside a home-screen app; Chromium with an iPhone user agent and no
    // PushManager behaves as that browser does for this check.
    test.use({ serviceWorkers: "allow", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" })
    test("claim: on an iPhone browser tab, the alert button explains Add to Home Screen instead of failing @phone", async ({ page, check }) => {
        await page.addInitScript(() => {
            delete (ServiceWorkerRegistration.prototype as { pushManager?: unknown }).pushManager
            delete (window as { PushManager?: unknown }).PushManager
        })
        let asked = false
        await page.exposeFunction("__asked", () => (asked = true))
        await page.addInitScript(() => (Notification.requestPermission = async () => ((window as unknown as { __asked: () => void }).__asked(), "denied")))
        await page.goto(WATCH_CARD)
        await page.locator("select#lang").selectOption("en")
        await expect(page.getByText("Your card is valid for this program")).toBeVisible({ timeout: 90_000 })
        await page.getByRole("button", { name: "Alert me when claims open" }).click()
        await expect(page.getByText("On iPhone, alerts work from the home screen: tap Share, then Add to Home Screen")).toBeVisible()
        expect(asked).toBe(false) // no permission prompt that iOS would refuse anyway
        await check(page)
    })
})

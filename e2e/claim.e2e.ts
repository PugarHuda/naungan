import { chromium } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, expect, MONEY } from "./fixtures"

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

    // The queued claim here is a placeholder proof the relayer would refuse, and /relay is answered locally
    // (context.route sees the service worker's own requests), so nothing could be paid even if it got out.
    // Chromium turns Background Sync off in throwaway profiles and in its headless shell, so this one runs full Chromium
    // with a persistent profile of its own (in a short temp path: Windows' 260-character limit breaks the cache storage).
    test("claim: Background Sync sends a queued claim from the service worker and says it was paid; a refused one is dropped @phone", async () => {
        const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pw-")), { channel: "chromium", baseURL: "http://localhost:4173", permissions: ["notifications", "background-sync"] })
        const page = context.pages()[0] ?? (await context.newPage())
        const sent: { status: number; body: any }[] = []
        let answer = 200
        await context.route(MONEY, async (r) => {
            if (!r.request().serviceWorker()) return r.abort()
            sent.push({ status: answer, body: r.request().postDataJSON() })
            await r.fulfill({ status: answer, contentType: "application/json", body: JSON.stringify(answer === 200 ? { txHash: "0x" + "ab".repeat(32), payout: "0x" + "12".repeat(20), amount: "500000" } : { error: "NotTriggered" }) })
        })
        await page.goto("/claim.html#join=6")
        await page.evaluate(() => navigator.serviceWorker.ready)
        const queue = (pid: string) => page.evaluate(async (pid) => {
            const job = { pid, proof: { merkleTreeDepth: 1, merkleTreeRoot: "1", nullifier: "1", message: "1", scope: pid, points: Array(8).fill("0") }, payout: "0x" + "12".repeat(20) }
            await (await caches.open("naungan-send")).put("/__claim__", new Response(JSON.stringify({ relay: "https://naungan.vercel.app/relay", job, note: { title: "Paid", body: "0.5 USDC is now in your wallet." } })))
            await (await navigator.serviceWorker.ready as any).sync.register("naungan-claim")
        }, pid)
        const left = () => page.evaluate(async () => !!(await (await caches.open("naungan-send")).match("/__claim__")))
        const notes = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}: ${n.body}`))

        await queue("2")
        await expect.poll(() => sent.length, { timeout: 30e3 }).toBe(1)
        expect(sent[0].body.programId).toBe("2")
        await expect.poll(left).toBe(false)
        await expect.poll(notes).toContain("Paid: 0.5 USDC is now in your wallet.")

        await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach((n) => n.close()))
        answer = 422 // the contract's own verdict: dropped, and no "paid" notification
        await queue("3")
        await expect.poll(() => sent.length, { timeout: 30e3 }).toBe(2)
        await expect.poll(left).toBe(false)
        expect(await notes()).toEqual([])

        await context.close()
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

test("claim: an enrolled household rates the aid anonymously: a Semaphore proof under the program's feedback scope, never its claim scope; sent once @phone", async ({ page, check }) => {
    const { feedbackScope } = await import("../lib/feedback.mjs")
    let body: { programId: string; proof: { scope: string; message: string; points: unknown[] } } | undefined
    let answer: [number, object] = [200, { txHash: "0x" + "cd".repeat(32) }]
    await page.route("**/feedback", async (r) => { // answered here: the rating is proved for real but never sent
        body = r.request().postDataJSON()
        await r.fulfill({ status: answer[0], contentType: "application/json", body: JSON.stringify(answer[1]) })
    })
    await page.goto(WATCH_CARD)
    await page.locator("select#lang").selectOption("en")
    const panel = page.locator("#feedback")
    await expect(panel.getByRole("heading", { name: "How was the help?" })).toBeVisible({ timeout: 60e3 })
    await check(page)
    await expect(panel.getByRole("button", { name: "Send anonymously" })).toBeDisabled() // no rating picked yet
    await panel.getByLabel("4 of 5").check({ force: true })
    await panel.getByLabel("Anything wrong?").selectOption({ label: "It came too late" })
    await panel.getByRole("button", { name: "Send anonymously" }).click()
    await expect(panel.getByRole("status")).toHaveText(/Thank you\. Your answer is on the public record, with no name\./, { timeout: 120e3 })
    expect(body!.programId).toBe("3")
    expect(BigInt(body!.proof.scope)).toBe(feedbackScope("0x00E9E8F7a9E8Dd4923Eb92eC5536f70ecD0C70f4", 3)) // not 3, the claim scope
    expect(body!.proof.message.toString()).toBe("14") // topic 1 ("late") × 10 + 4 stars
    expect(body!.proof.points).toHaveLength(8)
    await expect(panel.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", /\/tx\/0x(cd){32}$/)
    // The phone remembers: reopening shows the thanks, not the form.
    await page.reload()
    await expect(page.locator("#feedback").getByRole("status")).toContainText("Thank you", { timeout: 60e3 })
    // Rated from another phone: Semaphore refuses the second proof, and the app says so kindly.
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("naungan-rated-")).forEach((k) => localStorage.removeItem(k)))
    answer = [422, { error: "AlreadyRated" }]
    await page.reload()
    await page.locator("#feedback").getByLabel("2 of 5").check({ force: true })
    await page.locator("#feedback").getByRole("button", { name: "Send anonymously" }).click()
    await expect(page.locator("#feedback").getByRole("status")).toHaveText("This card has already answered. Thank you.", { timeout: 120e3 })
})

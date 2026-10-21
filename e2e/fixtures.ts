// Every test gets: the money endpoints (/relay, /transfer, /pin) cut off, so no test can ever spend; a
// failure on any console error or page error; and `check(page)`, which runs axe and the 360 px overflow test.
import { test as base, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

export const MONEY = /\/(relay|transfer|pin)(\?|$)/

// Noise from free public services under load, not from our code: rate limits (HTTP 429, the public RPC's
// JSON-RPC -32007 "request limit reached"), the indexer's and the wide-range history RPCs' retries, and the browser's own log line when a
// test deliberately takes the network away, or Open-Meteo not answering at all (the page then says so).
const ignorable = (text: string, url: string) =>
    /blockscout|gateway\.tenderly\.co|publicnode\.com/.test(url + text) || /\b429\b|request limit reached|ERR_INTERNET_DISCONNECTED/.test(text) || MONEY.test(url) ||
    (/open-meteo\.com/.test(url + text) && /ERR_TIMED_OUT|ERR_CONNECTION|ERR_FAILED|blocked by CORS policy/.test(text)) // refused without CORS headers

export const test = base.extend<{ check: (page: Page) => Promise<void>; errors: string[] }>({
    errors: [
        async ({ context, page }, use) => {
            const errors: string[] = []
            // Context-level guard; a test may add its own page.route for a money endpoint (it takes precedence)
            // to fulfill it, but the request still never leaves the browser.
            await context.route(MONEY, (r) => r.abort())
            const watch = (p: Page) => {
                p.on("console", (m) => m.type() === "error" && !ignorable(m.text(), m.location().url) && errors.push(m.text()))
                p.on("pageerror", (e) => errors.push(`page error: ${e.message}`))
            }
            watch(page)
            context.on("page", watch)
            await use(errors)
            expect(errors, "console or page errors").toEqual([])
        },
        { auto: true }
    ],
    check: async ({}, use, info) => {
        await use(async (page) => {
            const { violations } = await new AxeBuilder({ page }).analyze()
            expect(violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`), "axe violations").toEqual([])
            if (info.project.name === "phone") expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "horizontal overflow (px)").toBeLessThanOrEqual(0)
        })
    }
})
export { expect }

/**
 * Search a place on the launch page and pick the first match; false when there is none to pick. Open-Meteo's
 * geocoder often refuses GitHub's shared runners outright: then the page must say so in words (checked here), the
 * report notes it, and the caller skips what needs a place (it runs wherever the geocoder answers).
 */
export async function pickPlace(page: Page, name: string) {
    await page.locator("#place").fill(name)
    await page.getByRole("button", { name: "Search" }).click()
    const first = page.getByRole("list", { name: "Matching places" }).getByRole("button").first()
    const down = page.getByRole("status").filter({ hasText: /The place search is unavailable right now \(.+\)/ })
    await expect(first.or(down)).toBeVisible({ timeout: 30e3 })
    if (await down.isVisible()) {
        test.info().annotations.push({ type: "geocoder-unavailable", description: (await down.textContent())! })
        return false
    }
    await first.click()
    return true
}

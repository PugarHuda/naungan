import QRCode from "qrcode"
import { test, expect } from "./fixtures"

// vite preview has no serverless functions: /api/programs is answered by the live production endpoint (real chain data).
test.beforeEach(async ({ context }) => {
    await context.route("**/api/programs", async (r) => r.fulfill({ response: await r.fetch({ url: "https://naungan.vercel.app/api/programs" }) }))
})

test("poster: a Bangladesh program prints in Bengali with English underneath, and its QR opens registration", async ({ page, check }) => {
    await page.goto("/poster.html?program=6")
    await expect(page.locator("html")).toHaveAttribute("lang", "bn")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("আগাম নগদ সহায়তার জন্য নিবন্ধন করুন")
    await expect(page.getByText("Register for early cash support")).toBeVisible()
    await expect(page.locator("ol li")).toHaveCount(3)
    await expect(page.locator("ol li").nth(2)).toContainText("তাপপ্রবাহের") // a heat program says heatwave, not flood
    const join = "http://localhost:4173/claim.html#join=6"
    await expect(page.getByText(join)).toBeVisible()
    // The printed QR is exactly the registration link: the same library draws the same SVG for it.
    const svg = await page.locator(".qr svg").evaluate((el) => el.outerHTML)
    const want = await QRCode.toString(join, { type: "svg", margin: 0, errorCorrectionLevel: "Q" })
    const paths = (x: string) => [...x.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]) // the drawn modules, whatever the serialisation
    expect(paths(svg)).toEqual(paths(want))
    expect(paths(svg)[1]?.length).toBeGreaterThan(500)
    await check(page)
})

test("poster: prints on one A4 page, without the toolbar @desktop", async ({ page }) => {
    await page.goto("/poster.html?program=7&lang=en")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Register for early cash support")
    await page.emulateMedia({ media: "print" })
    await expect(page.getByRole("button", { name: "Print this poster" })).toBeHidden()
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true })
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1)
})

test("poster: a program whose trigger fired warns that registration is closed @desktop", async ({ page }) => {
    await page.goto("/poster.html?program=1")
    await expect(page.getByRole("alert")).toContainText("Registration for this program is closed")
})

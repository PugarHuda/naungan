import { test, expect } from "./fixtures"

// The agency side of self-registration, without a wallet (so nothing is ever sent): a real phone registration made
// in the same browser, then the enrollment page checking codes against the live chain.
test("enroll: codes from a phone are checked, kept across a reload, and need an agency wallet to send", async ({ page, check }) => {
    await page.goto("/claim.html#join=7")
    const code = (await page.locator("#joinCode").textContent())!.trim()
    expect(code).toMatch(/^naungan-commitment:7:\d+$/)

    await page.goto("/enroll.html?program=7")
    await expect(page.getByText(/households? enrolled so far/)).toBeVisible()
    const box = page.getByLabel(/Or paste codes/)
    await box.fill(`not a code\n${code}\n${code}\nnaungan-commitment:8:123\nnaungan-commitment:7:0`)
    await page.getByRole("button", { name: "Add pasted codes" }).click()
    await expect(page.getByRole("status")).toHaveText("Added 1 of 4 codes.") // "not a code" holds no code at all
    await expect(page.getByText("1 household ready to enroll")).toBeVisible()
    const refused = page.locator("details").filter({ hasText: "not added" })
    await expect(refused).toContainText("already scanned")
    await expect(refused).toContainText("program #8, not #7")
    await expect(refused).toContainText("damaged code")
    await check(page)

    await page.reload() // a dropped tab in the field keeps what was scanned
    await expect(page.getByText("1 household ready to enroll")).toBeVisible()
    await page.getByRole("button", { name: "Connect wallet and enroll 1" }).click()
    await expect(page.getByRole("status")).toContainText("no browser wallet found")
})

test("enroll: only programs still open for enrollment are offered @desktop", async ({ page }) => {
    await page.goto("/enroll.html?program=1") // program 1's trigger fired: enrollment is closed
    const options = page.locator("select option")
    await expect(options.first()).toBeAttached()
    const ids = await options.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    expect(ids).not.toContain("1")
    expect(ids).not.toContain("2")
    await expect(page).toHaveURL(new RegExp(`program=${ids[0]}$`))
})

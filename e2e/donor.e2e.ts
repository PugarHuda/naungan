import { test, expect } from "./fixtures"

// The live donor of every Base Sepolia program: its gifts come from a public RPC filtered on its address, the pools from the contract.
const DONOR = "0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E"

test("donor statement: a real donor's gifts, what reached households, and the contract's own record agreeing", async ({ page, check }) => {
    await page.goto(`/donor?address=${DONOR.toLowerCase()}`)
    await expect(page.getByRole("heading", { name: `Summary for ${DONOR}` })).toBeVisible({ timeout: 60_000 }) // checksummed; ten programs read one at a time from the public RPC
    await expect(page.getByText(/^Checked: for every program, the contract's own record/)).toBeVisible()
    const row2 = page.getByRole("row").filter({ hasText: "#2 Krueng Aceh flood · Aceh Besar" })
    await expect(row2.getByRole("cell").nth(1)).toHaveText("3") // gave 3 USDC
    await expect(row2.getByRole("cell").nth(2)).toHaveText(/^[1-3]$/) // paid for the program's claims (2 so far, the judges' card may make it 3)
    await expect(page.locator(".gifts li").first()).toContainText("USDC to #")
    expect(await page.locator(".gifts li").count()).toBeGreaterThanOrEqual(10)
    await expect(page.locator(".gifts li a").first()).toHaveAttribute("href", /sepolia\.basescan\.org\/tx\/0x[0-9a-f]{64}$/)
    await check(page)
})

test("donor statement: a wrong address is refused in words, an address that never gave says so @desktop", async ({ page }) => {
    await page.goto("/donor")
    await page.getByLabel("Donor address").fill("0x1234")
    await page.getByRole("button", { name: "Show statement" }).click()
    await expect(page.getByRole("status")).toHaveText(/Enter a wallet address/)
    await page.getByLabel("Donor address").fill("0x000000000000000000000000000000000000dEaD")
    await page.getByRole("button", { name: "Show statement" }).click()
    await expect(page.getByRole("status")).toHaveText(/has not funded any Naungan program/, { timeout: 30_000 })
    await expect(page).toHaveURL(/\?address=0x000000000000000000000000000000000000dEaD$/)
})

test("donor statement: with the wide-range RPCs refusing, the gifts come from the open data and still match the contract @desktop", async ({ page, context }) => {
    await context.route(/gateway\.tenderly\.co|publicnode\.com/, (r) => r.abort())
    await page.goto(`/donor?address=${DONOR}`)
    await expect(page.getByText(/Gifts found through open data\.$/)).toBeVisible({ timeout: 40_000 })
})

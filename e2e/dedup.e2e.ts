import { test, expect } from "./fixtures"
import { Wallet, getBytes } from "ethers"
import { digest, makeRequest, makeResponse } from "../web/src/dedup/exchange"
import { Agency } from "../lib/psi.mjs"
import { parseHouseholds } from "../lib/households.mjs"
import d from "../web/deployment.json"

const LIST = { name: "zakat.csv", mimeType: "text/csv", buffer: Buffer.from('name,birthYear,village\n"Begum, Fatimah",1990,kamp lhokseumawe\nMohammed Rafiq,2001,Kamp Aceh Timur\nAbdul Karim,1980,Kamp Pidie\n') }

// No wallet and no agency key in the test, so nothing is signed for real: the page reads the list on this computer,
// refuses to ask without an agency wallet, and the answering side checks a signed request against the live chain.
test("dedup: the list stays local, asking needs an agency wallet, answering checks the requester on-chain", async ({ page, check }) => {
    await page.goto("/dedup.html?program=7")
    const list = page.getByLabel(/Your household list/)
    await list.setInputFiles({ ...LIST, buffer: Buffer.from("name,village\nA,B\n") })
    await expect(page.getByRole("alert")).toContainText('missing column "birthYear"')
    await list.setInputFiles(LIST)
    await expect(page.getByText("3 households read from zakat.csv")).toBeVisible()
    await page.getByRole("button", { name: "Sign and download the request" }).click()
    await expect(page.getByRole("status")).toContainText("no browser wallet found")
    await check(page)

    // A request from a wallet that is not an agency of program 7, correctly signed: refused by the chain's answer.
    const stranger = Wallet.createRandom()
    const points = ["e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76"] // ristretto255's base point
    const ts = Date.now()
    const q = makeRequest({ names: "id", chainId: d.chainId, naungan: d.naungan, program: 7n, ts, from: stranger.address, signature: await stranger.signMessage(getBytes(digest(7n, ts, points))), points })
    await page.getByRole("button", { name: /Another agency asked me/ }).click()
    await expect(page).toHaveURL(/program=7#answer$/)
    let downloaded = false
    page.on("download", () => (downloaded = true))
    await page.getByLabel("Their request file").setInputFiles({ name: "request.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(q)) })
    await expect(page.getByRole("status")).toContainText(`Not answered: ${stranger.address} is not an agency of program #7`)
    // The same request with the other name profile chosen here: refused before anything else, by name.
    await page.getByLabel(/How names are matched/).selectOption("basic")
    await page.getByLabel("Their request file").setInputFiles({ name: "request2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(q)) })
    await expect(page.getByRole("status")).toContainText('matches names with the "id" profile, you chose "basic"')
    expect(downloaded).toBe(false)
    await check(page)
})

// The requester's side after their answer comes back, with real keys made here: a request this tab made (a pending
// one survives a reload) and the other agency's real answer. Matching runs in the page's worker.
test("dedup: the answer marks each household, the new ones export, and those with codes go to enrollment", async ({ page, check }) => {
    const csv = LIST.buffer.toString().replace("name,birthYear,village", "name,birthYear,village,commitment").replace(/\n(?=.)/g, ",\n").replace("Kamp Aceh Timur,", "Kamp Aceh Timur,naungan-commitment:7:12345678901234567890").replace(/,\n$/, "\n")
    const a = new Agency(parseHouseholds(csv, 7n), { profile: "id" })
    const points = a.request()
    const signer = Wallet.createRandom(), ts = Date.now()
    const request = makeRequest({ names: "id", chainId: d.chainId, naungan: d.naungan, program: 7n, ts, from: signer.address, signature: await signer.signMessage(getBytes(digest(7n, ts, points))), points })
    const b = new Agency(parseHouseholds("name,birthYear,village\nFatima Begum,1990,Kamp Lhokseumawe\nNur Kayas,1985,Kamp Pidie\nAbdul Karim,1979,Kamp Pidie\n"), { profile: "id" })
    const answer = makeResponse(request, b.respond(points))
    const pending = JSON.stringify({ request, secret: a.secret.toString(16), layout: a.layout, csv, names: "id" })
    await page.addInitScript((p) => { if (!sessionStorage.getItem("naungan-dedup-pending")) sessionStorage.setItem("naungan-dedup-pending", p) }, pending)

    await page.goto("/dedup.html?program=7")
    await page.reload() // the tab was reloaded while waiting: the request is still open
    await expect(page.getByText(/Request for program #7 made .* \(\d+ blinded keys\)/)).toBeVisible()
    await page.getByLabel("Their answer file").setInputFiles({ name: "answer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(answer)) })
    await expect(page.getByRole("status")).toHaveText(/1 already served by the other agency · 1 possible .* · 1 new/)
    await expect(page.locator("table.dedup tbody tr")).toHaveText([/Begum, Fatimah.*Already served/, /Mohammed Rafiq.*New/, /Abdul Karim.*Check/])
    await check(page)

    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download the 1 new" }).click()])
    expect(dl.suggestedFilename()).toBe("households.new.csv")
    expect(await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())).toBe('name,birthYear,village,commitment\r\n"Mohammed Rafiq","2001","Kamp Aceh Timur","12345678901234567890"\r\n')
    await page.getByRole("button", { name: "Enroll the 1 new with registration codes" }).click()
    await expect(page).toHaveURL(/enroll\?program=7$/)
    await expect(page.getByText("1 household ready to enroll")).toBeVisible()
})

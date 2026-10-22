// Records the captioned product tour (web/public/demo.mp4) from the live site: a real browser driven by Playwright,
// every screen live data, captions timed to what is on screen and burned in with ffmpeg. Never presses Claim on the
// judges' demo card. Run: node scripts/demo-video.cjs  (needs ffmpeg with libass on PATH; SITE= to record another site)
const { chromium } = require("@playwright/test")
const { execFileSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const SITE = process.env.SITE || "https://naungan.vercel.app"
const CARD = "/claim#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D"
const OUT = path.join(__dirname, "..", "web", "public")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "naungan-video-"))

const cues = []
let t0 = 0
const now = () => (Date.now() - t0) / 1000
/** One caption, shown for at least `secs` while the page does what it says. */
async function say(text, secs, during = async () => {}) {
    const start = now()
    await Promise.all([during(), new Promise((r) => setTimeout(r, secs * 1000))])
    cues.push({ start, end: now(), text })
}
const srtTime = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 23).replace(".", ",")

;(async () => {
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } }, colorScheme: "light" })
    const page = await ctx.newPage()
    // Never spend from the recording: the claim and transfer endpoints are cut off, as in the e2e suite.
    await ctx.route(/\/(relay|transfer|pin|feedback)(\?|$)/, (r) => r.abort())
    const smooth = (y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y)
    const to = (sel) => page.locator(sel).first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }))
    t0 = Date.now()

    await page.goto(SITE + "/")
    await say("Naungan: cash that reaches families before the flood, heatwave or cyclone.", 5)
    await say("Live on Base: 10 programs in 6 countries, each on a Red Cross / Red Crescent trigger.", 5, () => smooth(500))
    await say("Why early: families WFP paid before the 2020 Jamuna flood were 36% less likely to go a day without eating.", 7, () => to("#evidence"))

    await page.goto(SITE + "/dashboard?program=2")
    await page.locator('[role="log"] .row').first().waitFor({ timeout: 60e3 })
    await say("The public dashboard is rebuilt from chain events. No household is named.", 5)
    await say("Two independent forecasts, posted every 6 hours, with evidence anyone can recompute.", 5, () => to(".screen"))
    await say("Verify every payout: this browser re-checks each claim's zero-knowledge proof.", 9, async () => {
        await to("#audit, article:has(button:has-text('Verify every payout'))")
        await page.getByRole("button", { name: "Verify every payout" }).click().catch(() => {})
        await page.locator("b", { hasText: / of \d+$/ }).first().waitFor({ timeout: 60e3 }).catch(() => {})
    })
    await say("In plain words: what a family reads, written by Claude and checked number by number.", 7, () => to("#plain"))
    await say("Running costs, from real transactions: about half a cent per family's claim on Base.", 7, () => to("#costs"))

    await page.goto(SITE + CARD)
    await page.locator("select#lang").selectOption("id").catch(() => {})
    await say("The family's claim app, in its own language: seven languages, works offline.", 6)
    await say("Why this money? The trigger explained from on-chain facts only. Nothing about the family is sent.", 8, async () => {
        await page.getByRole("region", { name: "Kenapa uang ini?" }).waitFor({ timeout: 60e3 }).catch(() => {})
        await to("section.why")
    })
    await say("Tapping Claim proves membership in zero knowledge; 1 USDC lands in about 12 seconds. Try this card yourself.", 7, () => smooth(0))

    await page.goto(SITE + "/donor?address=0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E")
    await page.getByText(/^Checked: for every program/).waitFor({ timeout: 60e3 }).catch(() => {})
    await say("Donors see where their money went, checked against the contract's own record.", 7, () => smooth(300))

    await page.goto(SITE + "/launch")
    await say("Any agency can launch a program from a browser wallet, starting from a published Early Action Protocol.", 7)
    await say("Open data in the formats aid already reads: IATI, HXL, CAP alerts in two languages. naungan.vercel.app", 6)

    const video = page.video()
    await ctx.close()
    await browser.close()
    const webm = await video.path()
    // Keep only the narrated stretches: waits for a slow public RPC between them are cut, and each caption moves to where
    // its stretch lands in the cut video.
    let at = 0
    const kept = cues.map((c) => ({ ...c, from: at, to: (at += c.end - c.start) }))
    const select = cues.map((c) => `between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})`).join("+")
    const srt = path.join(dir, "captions.srt")
    fs.writeFileSync(srt, kept.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join("\n"))
    fs.copyFileSync(srt, path.join(OUT, "demo.srt"))
    // ffmpeg's subtitles filter wants a relative path on Windows (a drive colon breaks its option parser).
    const style = "FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=14"
    execFileSync("ffmpeg", ["-y", "-i", webm, "-vf", `select='${select}',setpts=N/FRAME_RATE/TB,subtitles=captions.srt:force_style='${style}'`, "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", path.join(OUT, "demo.mp4")], { cwd: dir, stdio: "inherit" })
    execFileSync("ffmpeg", ["-y", "-ss", "16", "-i", path.join(OUT, "demo.mp4"), "-frames:v", "1", "-q:v", "4", path.join(OUT, "demo-poster.jpg")], { stdio: "inherit" })
    console.log(`demo.mp4: ${cues.length} captions, ${at.toFixed(0)} s (recorded ${now().toFixed(0)} s)`)
})()

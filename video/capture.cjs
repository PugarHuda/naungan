// Records every feature of the live site for the demo video (src/Demo.tsx composes it): one Playwright clip per scene,
// driven like a person would: a visible cursor glides to each control and clicks it, text is typed key by key, and a
// labelled box marks what the narration is talking about. Each spoken line is synthesised first with a Microsoft neural
// voice (edge-tts, `pip install edge-tts`), so narration and caption are timed to what the page is doing. Figures that
// change (programs, the trigger's record) are read from the page and spoken as found. Never presses Claim on the
// judges' card, and the endpoints that move money are cut off, as in the e2e suite.
// Writes public/manifest.json, public/clips/*.webm, public/voice/*.mp3.
//
//   node capture.cjs                    (SITE= another deployment, VOICE= another edge-tts voice)
//   ONLY=dashboard,open node capture.cjs  re-record those scenes, keep the rest of public/manifest.json
const { chromium } = require("@playwright/test")
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const SITE = process.env.SITE || "https://naungan.vercel.app"
const VOICE = process.env.VOICE || "en-US-AvaMultilingualNeural"
const CARD = "/claim#p=2&id=sG0DdcsCNBfd7i%2FIGGuxLmkPFbIN2ydmlblYsEm3rK8%3D" // the judges' demo card (program 2)
const DONOR = "0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E"
const PUB = path.join(__dirname, "public")
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null
const MANIFEST = path.join(PUB, "manifest.json")
const before = ONLY && fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")).scenes : []
for (const d of ["clips", "voice"]) {
    if (!ONLY) fs.rmSync(path.join(PUB, d), { recursive: true, force: true })
    fs.mkdirSync(path.join(PUB, d), { recursive: true })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let current = "", n = 0
/** The line spoken as an mp3 (made before the page acts, so synthesis is never on screen), with its length. */
function speak(text) {
    const file = `voice/${current}-${n++}.mp3`
    for (let i = 0; ; i++) {
        try {
            execFileSync("python", ["-m", "edge_tts", "--voice", VOICE, "--rate", "+2%", "--text", text, "--write-media", path.join(PUB, file)], { stdio: "ignore" })
            break
        } catch (e) {
            if (i >= 3) throw e
        }
    }
    return { file, secs: Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(PUB, file)]).toString()) }
}

// In every page of the recording: a cursor that follows the real mouse events Playwright sends, a ripple on each press,
// and window.__box() to frame an element with a label. Injected by Playwright, so the site's CSP is untouched.
function overlay() {
    const mk = () => {
        if (document.getElementById("__cur")) return
        const c = document.createElement("div")
        c.id = "__cur"
        c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 2.5l14 8.2-6.3 1.6-2.9 6.2z" fill="#0A0B0F" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
        Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-80px,-80px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" })
        document.documentElement.appendChild(c)
        addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 3}px)`), true)
        addEventListener("mousedown", (e) => {
            const r = document.createElement("div")
            Object.assign(r.style, { position: "fixed", left: e.clientX - 20 + "px", top: e.clientY - 20 + "px", width: "40px", height: "40px", borderRadius: "50%", border: "3px solid #3DD27B", background: "rgba(61,210,123,.25)", zIndex: "2147483646", pointerEvents: "none", transition: "transform .55s ease-out, opacity .55s ease-out" })
            document.documentElement.appendChild(r)
            requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(r.style, { transform: "scale(1.9)", opacity: "0" })))
            setTimeout(() => r.remove(), 700)
        }, true)
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mk)
    else mk()
    window.__box = (x, y, w, h, label, ms) => {
        const b = document.createElement("div")
        Object.assign(b.style, { position: "fixed", left: x - 6 + "px", top: y - 6 + "px", width: w + 12 + "px", height: h + 12 + "px", border: "3px solid #3DD27B", borderRadius: "12px", boxShadow: "0 0 0 6px rgba(61,210,123,.18)", zIndex: "2147483645", pointerEvents: "none", opacity: "0", transition: "opacity .3s" })
        if (label) {
            const t = document.createElement("div")
            t.textContent = label
            Object.assign(t.style, { position: "absolute", left: "-3px", top: y - 6 > 34 ? "-32px" : "calc(100% + 6px)", background: "#3DD27B", color: "#0A0B0F", font: "700 14px/1 system-ui,sans-serif", padding: "7px 10px", borderRadius: "8px", whiteSpace: "nowrap" })
            b.appendChild(t)
        }
        document.documentElement.appendChild(b)
        requestAnimationFrame(() => requestAnimationFrame(() => (b.style.opacity = "1")))
        setTimeout(() => (b.style.opacity = "0"), ms)
        setTimeout(() => b.remove(), ms + 400)
    }
}

const scenes = []
async function scene(browser, id, chapter, url, run) {
    if (ONLY && !ONLY.includes(id)) {
        const kept = before.find((x) => x.id === id)
        if (!kept) throw new Error(`${id} is not in the manifest yet: record it`)
        return void scenes.push(kept)
    }
    for (let attempt = 1; ; attempt++) {
        current = id
        n = 0
        try {
            return await record(browser, id, chapter, url, run)
        } catch (e) {
            console.warn(`  ${id} failed (${e.message.split("\n")[0]})${attempt < 2 ? ", recording it again" : ""}`)
            if (attempt >= 2) throw e
            await sleep(20e3) // let a rate-limited public RPC recover
        }
    }
}

async function record(browser, id, chapter, url, run) {
    const tmp = path.join(PUB, "clips", id)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } }, colorScheme: "light", locale: "en-US" })
    await ctx.addInitScript(overlay)
    await ctx.route(/\/(relay|transfer|pin|feedback|subscribe)(\?|$)/, (r) => r.abort())
    const page = await ctx.newPage()
    const t0 = Date.now()
    const now = () => (Date.now() - t0) / 1000
    const segments = []
    let mouse = { x: 640, y: 400 }

    /** One line: spoken and captioned while `during` runs; the segment lasts as long as both. */
    const say = async (text, during = async () => {}) => {
        const v = speak(text)
        const from = now()
        await Promise.all([during().catch((e) => console.warn(`  ${id}: ${e.message.split("\n")[0]}`)), sleep((v.secs + 0.5) * 1000)])
        segments.push({ from, to: now(), text, voice: v.file, voiceSecs: v.secs })
    }
    /** Scrolls an element to the middle of the screen, smoothly. */
    const into = async (loc, block = "center") => {
        await loc.first().evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block)
        // Wait for the smooth scroll to settle, or the element is measured mid-flight and the click lands elsewhere.
        let last = -1
        for (let i = 0; i < 40; i++) {
            await sleep(120)
            const y = await page.evaluate(() => scrollY)
            if (y === last) break
            last = y
        }
        await sleep(200)
    }
    /** Glides the cursor to the element's centre, the way a hand moves: eased, about half a second. */
    const point = async (loc) => {
        await into(loc)
        const r = await loc.first().boundingBox()
        if (!r) return null
        const to = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        const steps = 28
        for (let i = 1; i <= steps; i++) {
            const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
            await page.mouse.move(mouse.x + (to.x - mouse.x) * e, mouse.y + (to.y - mouse.y) * e)
            await sleep(16)
        }
        mouse = to
        return r
    }
    /** Frames an element with a labelled box while the narration talks about it. */
    const box = async (loc, label, ms = 2600) => {
        await into(loc)
        const r = await loc.first().boundingBox()
        if (r) await page.evaluate(([r, label, ms]) => window.__box(r.x, r.y, r.width, r.height, label, ms), [r, label, ms])
    }
    /** Moves to the control, frames it, and clicks it with the mouse. */
    const click = async (loc, label) => {
        const r = await point(loc)
        if (label && r) await page.evaluate(([r, label]) => window.__box(r.x, r.y, r.width, r.height, label, 1400), [r, label])
        await sleep(350)
        await page.mouse.down()
        await sleep(90)
        await page.mouse.up()
        await sleep(500)
    }
    /** Clicks into a field and types, key by key. */
    const type = async (loc, text) => {
        await click(loc)
        await loc.first().fill("")
        await loc.first().pressSequentially(text, { delay: 75 })
    }
    const ready = (loc, ms = 90e3) => loc.first().waitFor({ timeout: ms })
    console.log(`${id}: ${url}`)
    await page.goto(SITE + url, { waitUntil: "domcontentloaded", timeout: 60e3 })
    await run({ page, say, into, point, box, click, type, ready })
    await sleep(500)
    const video = page.video()
    await ctx.close()
    fs.renameSync(await video.path(), path.join(PUB, "clips", `${id}.webm`))
    fs.rmSync(tmp, { recursive: true, force: true })
    scenes.push({ id, chapter, clip: `clips/${id}.webm`, segments })
}

;(async () => {
    const b = await chromium.launch()
    const LIST = { name: "zakat.csv", mimeType: "text/csv", buffer: Buffer.from('name,birthYear,village\n"Begum, Fatimah",1990,kamp lhokseumawe\nMohammed Rafiq,2001,Kamp Aceh Timur\nAbdul Karim,1980,Kamp Pidie\n') }

    await scene(b, "problem", "The problem", "/", async ({ page, say, box }) => {
        await say("Naungan means shelter. It is cash that reaches families before a flood, a heatwave or a cyclone.", () => box(page.locator("#h1"), "Anticipatory cash", 4000))
        await say("Today, aid agencies cannot see each other's lists. Some families are paid twice, others are missed, and the money arrives after the water.", () => box(page.locator("#problem h2"), "Three failures", 5000))
        await say("When the World Food Programme paid families days before the 2020 Jamuna flood peaked, they were 36 percent less likely to go a day without eating.", () => box(page.locator("#evidence h2"), "Evidence", 6000))
    })

    await scene(b, "how", "How it works", "/#how", async ({ page, say, box }) => {
        await say("Naungan coordinates without sharing. Agencies compare lists by private set intersection, and only anonymous commitments go on-chain.", () => box(page.locator("#how h2"), "How it works", 5000))
        await say("Two independent forecasts must agree before claims open, and each family claims from its phone with a zero-knowledge proof: paid once, and nobody can tell who was paid.", () => box(page.locator("#privacy h2"), "Privacy", 6000))
        await say("Blockchains already move aid. What is new: no list leaves an agency, money moves before the disaster, and anyone can verify every payout.", () => box(page.locator("#new .cmp"), "Compared with what exists", 7000))
    })

    await scene(b, "world", "Live programs", "/#programs", async ({ page, say, box, click, type, ready }) => {
        await ready(page.locator("#worldSum").filter({ hasText: /\d+ programs/ }))
        const [, p, c] = (await page.locator("#worldSum").textContent()).match(/(\d+) programs in (\d+) countries/)
        await say(`${p} live programs in ${c} countries, each on the trigger the local Red Cross or Red Crescent society published.`, () => box(page.locator("#programs ul.world"), `${p} live programs`, 6000))
        await ready(page.locator(".record-stats b").filter({ hasText: /^\d+$/ }))
        const [paid, held] = await page.locator(".record-stats b").allTextContents()
        const last = (await page.locator(".record-stats b").nth(2).textContent()).trim()
        await say(`Replayed over thirty years, the Aceh trigger would have paid ${paid} times, most recently on ${last}, and held back ${held} rain-only alarms.`, () => box(page.locator(".record-stats"), "30-year replay", 7000))
        await say("And anyone can check any river on Earth. Here is Sylhet, in Bangladesh.", async () => {
            await type(page.locator("#anyQ"), "Sylhet")
            await click(page.getByRole("button", { name: "Search places" }))
            await ready(page.getByRole("list", { name: "Matching places" }).getByRole("button"), 30e3)
            await click(page.getByRole("list", { name: "Matching places" }).getByRole("button").first())
        })
        await say("The page finds the main river, its flood level, and how often a program there would have paid.", async () => {
            await ready(page.locator(".anyout .figs"))
            await box(page.locator(".anyout .figs"), "Computed in your browser", 5000)
        })
    })

    await scene(b, "dashboard", "Public dashboard", "/dashboard?program=2", async ({ page, say, box, click, ready }) => {
        await ready(page.locator('[role="log"] .row'))
        await say("The public dashboard is rebuilt from chain events, in your browser. No household is ever named.", () => box(page.locator('[role="log"]'), "Ledger from chain events", 5000))
        await say("The oracles post their forecasts with evidence, and anyone can recompute a report in their own browser.", async () => {
            const btn = page.getByRole("button", { name: "Recompute in my browser" }).first()
            await click(btn, "Recompute")
            const verdict = page.locator(".oracle").getByText(/Matches|Not comparable|Mismatch/)
            await ready(verdict, 60e3)
            await box(verdict, "Recomputed in this browser", 3500)
        })
        await say("Official GDACS alerts and the Red Cross plan for the area sit beside the trigger.", () => box(page.locator("article:has(#gdacsH)"), "Official alerts", 4500))
        await say("In plain words: Claude explains the trigger in the family's language, shown only if every number matches the on-chain facts.", async () => {
            await box(page.locator("#plain"), "Checked AI explanation", 6000)
        })
        await say("Running costs are measured from real transactions: about half a cent for a family's claim on Base.", async () => {
            await ready(page.locator("#costs").getByRole("row").filter({ hasText: "A household's claim" }), 60e3)
            await box(page.locator("#costs").getByRole("row").filter({ hasText: "A household's claim" }), "Measured, priced on Base", 5000)
        })
        await say("Families rate the aid with a second zero-knowledge proof: one rating per family, never linked to its payment.", () => box(page.locator("#feedback"), "Anonymous, proven feedback", 5500))
    })

    await scene(b, "audit", "Verify every payout", "/dashboard?program=1", async ({ page, say, box, click, ready }) => {
        await ready(page.locator('[role="log"] .row'))
        await say("Verify every payout: this browser fetches each claim transaction and checks its zero-knowledge proof again.", async () => {
            await click(page.getByRole("button", { name: "Verify every payout" }), "Verify every payout")
            await ready(page.locator("b", { hasText: / of \d+$/ }))
            await box(page.locator(".head.verdict").first(), "Every proof re-checked", 3500)
        })
        await say("Auditors sign the result on the Ethereum Attestation Service, so donors count independent checks instead of trusting us.", () => box(page.getByRole("button", { name: "Sign this result on-chain (EAS)" }), "Sign on EAS", 4500))
        await say("Each program's payouts are also a hypercert, on Hypercerts' own contract, split among the donors who paid for them.", () => box(page.locator("article:has(#hcH) .hcard"), "Impact certificate", 5500))
        await say("Anyone can re-check the certificate on Hypercerts' four counts, then sign the evaluation on-chain.", async () => {
            await click(page.getByRole("button", { name: "Check this certificate" }), "Check this certificate")
            await ready(page.getByText("✓ Files are the ones minted"))
            await box(page.locator("article:has(#hcH) .hcv"), "Four counts, all valid", 3500)
        })
    })

    await scene(b, "claim", "The family's phone", CARD, async ({ page, say, box, ready, into }) => {
        await page.locator("select#lang").selectOption("en")
        await say("This is the family's claim app. It works offline, reads aloud, and speaks seven languages.", () => box(page.locator("select#lang"), "7 languages", 4500))
        await say("Why this money? The trigger, explained from public facts only. Nothing about the family is sent.", async () => {
            await ready(page.locator("section.why .whytext"), 60e3)
            await box(page.locator("section.why"), "Why this money?", 5500)
        })
        await say("Tapping Claim proves the family is enrolled without saying who it is. One US dollar lands in about twelve seconds, and judges can try this very card.", async () => {
            const claim = page.getByRole("button", { name: "Claim now" })
            await into(claim)
            await box(claim, "Zero-knowledge claim (not pressed here)", 6000)
        })
    })

    let code = ""
    await scene(b, "join", "Self-registration", "/claim#join=7", async ({ page, say, box, ready }) => {
        await ready(page.locator("#joinCode"))
        code = (await page.locator("#joinCode").textContent()).trim()
        await say("Families with a phone register themselves. The phone keeps its secret and shows only an anonymous registration code, with the amount in local money.", () => box(page.locator("#joinCode"), "Anonymous registration code", 7000))
    })

    await scene(b, "enroll", "Agency enrollment", "/enroll?program=7", async ({ page, say, click, type, box }) => {
        await say("The agency pastes the codes it collected and enrolls them in one transaction, from its own wallet.", async () => {
            await type(page.locator("textarea").first(), code.slice(0, 40))
            await page.locator("textarea").first().fill(code)
            await click(page.getByRole("button", { name: "Add pasted codes" }), "Add codes")
            await box(page.getByRole("status"), "Checked locally", 2500)
        })
    })

    await scene(b, "dedup", "Dedup without sharing", "/dedup?program=7", async ({ page, say, box, ready, point }) => {
        await say("Two agencies check their lists against each other without either seeing the other's names. The list never leaves this computer.", async () => {
            const input = page.getByLabel(/Your household list/)
            await point(input)
            await input.setInputFiles(LIST)
            await ready(page.getByText("3 households read from zakat.csv"))
            await box(page.getByText("3 households read from zakat.csv"), "Read on this computer only", 4000)
        })
    })

    await scene(b, "launch", "Launch a program", "/launch", async ({ page, say, click, type, box, ready, point }) => {
        await say("Any agency can launch a program from a published Early Action Protocol: the trigger, the place, the people within reach and the budget.", async () => {
            await point(page.locator("select#preset"))
            await page.locator("select#preset").selectOption("bdrcs-heat")
            await box(page.locator("select#preset"), "Red Crescent heatwave protocol", 2500)
            await type(page.locator("#place"), "Dhaka")
            await click(page.getByRole("button", { name: "Search" }))
            await ready(page.getByRole("list", { name: "Matching places" }).getByRole("button"), 30e3)
            await click(page.getByRole("list", { name: "Matching places" }).getByRole("button").first())
            await ready(page.locator("#people"), 30e3)
            await box(page.locator("#people"), "People within reach (WorldPop)", 3500)
        })
    })

    await scene(b, "poster", "Posters and widgets", "/poster?program=6", async ({ page, say, box }) => {
        await say("A printable poster, in English or the local language, invites households to register with a QR code.", () => box(page.locator(".qr"), "Scan to register", 4500))
        await say("And partners embed a live card of any program on their own site.", async () => {
            await page.goto(SITE + "/embed?program=7", { waitUntil: "domcontentloaded" })
            await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30e3 })
            await box(page.locator("body > *").first(), "Embeddable widget", 3500)
        })
    })

    await scene(b, "donor", "Donor statement", `/donor?address=${DONOR}`, async ({ page, say, box, ready, point }) => {
        await ready(page.getByText(/^Checked: for every program/))
        await say("Donors see where every gift went, checked against the contract's own record.", () => box(page.locator(".tiles"), "Where the money went", 5000))
        await say("And they claim their fraction of each impact certificate, to keep, give, or offer to a retroactive funder.", async () => {
            await ready(page.locator(".hc"))
            await box(page.locator(".hc").first(), "Your fraction", 3000)
            await point(page.getByRole("button", { name: "Add to my wallet" }).first())
        })
    })

    await scene(b, "open", "Open data", "/dashboard?program=2", async ({ page, say, box, ready }) => {
        await ready(page.getByRole("link", { name: "CAP alerts" }))
        await say("Everything is open data in the formats aid already reads: IATI, HXL, GeoJSON, and bilingual CAP alerts that national warning systems can relay.", async () => {
            await box(page.getByRole("link", { name: "CAP alerts" }).locator(".."), "Open data", 3500)
            await page.goto(SITE + "/api/programs", { waitUntil: "domcontentloaded" })
        })
    })

    // The closing card is drawn by Remotion; only its narration is made here.
    const close = ["The contract has no owner, so nobody can change the rules after donors give.", "It is rehearsed on a fork of Base mainnet with Circle's real USDC, and checked by more than two hundred and forty automated tests.", "Try it at naungan dot vercel dot app."]
    current = "close"
    n = 0
    scenes.push({ id: "close", chapter: "Try it", clip: null, segments: close.map((text) => { const v = speak(text); return { text, voice: v.file, voiceSecs: v.secs } }) })

    await b.close()
    fs.writeFileSync(MANIFEST, JSON.stringify({ site: SITE, voice: VOICE, recorded: new Date().toISOString(), scenes }, null, 2))
    console.log(`${scenes.length} scenes, ${scenes.reduce((s, x) => s + x.segments.length, 0)} lines`)
})()

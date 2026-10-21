<script lang="ts">
    // Printable A4 registration poster for one program (poster?program=N[&lang=xx]): a large QR code for
    // claim#join=N, three steps in English (or ?lang= with English underneath), and the privacy promise.
    // Reads the edge-cached /api/programs; the QR is drawn here as SVG, so it prints sharp at any size.
    import { onMount } from "svelte"
    import QRCode from "qrcode"
    import { P, posterLang } from "./i18n"

    type Prog = { id: number; name: string; hazard: "flood" | "heat"; country: string | null; state: string; usdc: { perHousehold: number } }
    const q = new URLSearchParams(location.search)
    const id = Number(q.get("program"))
    const join = `${location.origin}/claim#join=${id}`

    let p = $state<Prog | null>(null)
    let qr = $state("")
    let err = $state("")
    const lang = posterLang(q.get("lang"))
    const heat = $derived(p?.hazard === "heat")

    onMount(async () => {
        if (!Number.isInteger(id) || id < 1) return void (err = "Add ?program=<id> to the address.")
        try {
            const r = await fetch("/api/programs")
            if (!r.ok) throw new Error(`open data answered ${r.status}`)
            const found = ((await r.json()).programs as Prog[]).find((x) => x.id === id)
            if (!found) return void (err = `There is no program #${id}.`)
            qr = await QRCode.toString(join, { type: "svg", margin: 0, errorCorrectionLevel: "Q" }) // Q: survives a fold or a smudge
            p = found
            document.documentElement.lang = lang
            document.title = `${P[lang].title} · ${found.name}`
        } catch (e) {
            err = `Could not read the program: ${(e as Error).message}`
        }
    })
</script>

{#if p}
    <header class="bar">
        <button type="button" onclick={() => print()}>Print this poster</button>
        {#if p.state !== "watching"}<p role="alert">Registration for this program is closed ({p.state}); phones that scan it cannot join now.</p>{/if}
        <a href="enroll?program={p.id}">Enroll the codes households show →</a>
    </header>
    <main>
    <article class="poster">
        <h1>{P[lang].title}</h1>
        {#if lang !== "en"}<p class="en" lang="en">{P.en.title}</p>{/if}
        <p class="program">{p.name}</p>
        <p class="amount">{P[lang].per(`${p.usdc.perHousehold} USDC`, heat)}</p>
        <div class="qr" role="img" aria-label="QR code that opens the registration page">{@html qr}</div>
        <p class="url">{join}</p>
        <ol>
            {#each P[lang].steps(heat) as step, i (i)}
                <li>{step}{#if lang !== "en"}<span class="en" lang="en">{P.en.steps(heat)[i]}</span>{/if}</li>
            {/each}
        </ol>
        <p class="privacy">{P[lang].privacy}{#if lang !== "en"}<span class="en" lang="en">{P.en.privacy}</span>{/if}</p>
        <p class="brand">NAUNGAN · naungan.vercel.app</p>
    </article>
    </main>
{:else}
    <main><p class="wait" role="status">{err || "Loading the program…"}</p></main>
{/if}

<style>
    :global(body) { margin: 0; background: #e9ecef; color: #111; font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Bengali", sans-serif }
    .bar { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; padding: 14px 16px; max-width: 210mm; margin: 0 auto; box-sizing: border-box }
    .bar button { font: 600 16px system-ui, sans-serif; padding: 10px 18px; border-radius: 10px; border: 0; background: #111; color: #fff; cursor: pointer }
    .bar a { color: #0a6b36; font-weight: 600 }
    .bar p { flex-basis: 100%; margin: 0; color: #9a3412; font-weight: 600 }
    .poster { background: #fff; width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto 24px; padding: 16mm 14mm; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; text-align: center }
    h1 { font-size: 34px; line-height: 1.15; margin: 0 }
    .en { display: block; font-size: 0.72em; color: #444; margin-top: 2px }
    p.en { font-size: 20px; margin: 4px 0 0 }
    .program { font-size: 20px; font-weight: 700; margin: 14px 0 0 }
    .amount { font-size: 22px; margin: 6px 0 0; color: #0a6b36; font-weight: 700 }
    .qr { width: 95mm; max-width: 80vw; margin: 10mm 0 3mm }
    .qr :global(svg) { width: 100%; height: auto; display: block }
    .url { font: 12px ui-monospace, monospace; color: #555; word-break: break-all; margin: 0 }
    ol { text-align: left; font-size: 20px; margin: 9mm 0 0; padding-left: 1.4em; max-width: 160mm }
    li { margin: 0 0 5mm }
    li .en { font-size: 15px }
    .privacy { margin: auto 0 0; padding-top: 6mm; font-weight: 600; font-size: 17px; max-width: 160mm }
    .privacy .en { font-size: 14px; font-weight: 400 }
    .brand { margin: 5mm 0 0; letter-spacing: 0.2em; font-size: 12px; color: #666 }
    .wait { padding: 24px 16px }
    @media print {
        @page { size: A4; margin: 0 }
        :global(body) { background: #fff }
        .bar { display: none }
        .poster { margin: 0; width: 210mm; height: 297mm; min-height: 0 }
    }
    @media (max-width: 640px) {
        .poster { padding: 24px 16px; min-height: 0 }
        h1 { font-size: 26px }
        ol { font-size: 17px }
    }
</style>

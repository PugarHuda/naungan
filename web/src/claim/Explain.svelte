<script lang="ts">
    // "Why this money?": the program's trigger explained in the household's language by an AI model, from public
    // on-chain facts only, and shown only after every figure in it was checked against those facts (api/explain.js,
    // lib/explain.mjs). The request names the program and the language, never the card. Hidden when offline or when
    // the deployment has no model, so the claim never depends on it.
    import { deployment as d } from "../shared/chain"
    import { ui, card, t } from "./state.svelte"
    import { pickVoice } from "./speech"

    type Answer = { text: string | null; facts: Record<string, string | number>; model?: string }
    let got = $state<Answer | null>(null)
    let asked = ""
    $effect(() => {
        // card.pid is plain data: the snapshot (reactive) arriving is what says the card's program is known.
        const snap = ui.snap, pid = card.pid, lang = ui.lang
        if (!snap || snap.offline || pid === null || asked === `${pid}:${lang}`) return // the snapshot refreshes; ask once per program and language
        asked = `${pid}:${lang}`
        got = null
        fetch(`${d.relayer ?? location.origin}/api/explain?program=${pid}&lang=${lang}`, { signal: AbortSignal.timeout(45e3) })
            .then((r) => (r.ok ? r.json() : null))
            .then((a: Answer | null) => card.pid === pid && ui.lang === lang && a?.text && (got = a))
            .catch(() => {}) // optional: the card works without it
    })
    const synth = typeof speechSynthesis === "undefined" ? null : speechSynthesis
    function listen() {
        if (!synth || !got?.text) return
        synth.cancel()
        const u = new SpeechSynthesisUtterance(got.text)
        const v = pickVoice(synth.getVoices(), ui.lang, ui.country)
        if (v) (u.voice = v), (u.lang = v.lang)
        synth.speak(u)
    }
</script>

{#if got?.text}
    <section class="card why" aria-labelledby="whyH">
        <h2 id="whyH">{t("whyTitle")}</h2>
        <p class="whytext">{got.text}</p>
        {#if synth && pickVoice(synth.getVoices(), ui.lang, ui.country)}<button class="link" type="button" onclick={listen}>{t("whyListen")}</button>{/if}
        <p class="fine">{t("whyAi")}{got.model ? ` (${got.model})` : ""}</p>
        <details>
            <summary>{t("whyFacts")}</summary>
            <dl class="facts">
                {#each Object.entries(got.facts) as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
            </dl>
        </details>
    </section>
{/if}

<style>
    .why h2 { font-size: 18px; margin: 0 0 8px }
    .whytext { font-size: 17px; line-height: 1.5; margin: 0 0 8px }
    .fine { font-size: 13px; opacity: 0.8; margin: 8px 0 }
    .facts { font-size: 13px; display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 8px 0 0 }
    .facts dt { font-weight: 600 }
    .facts dd { margin: 0; overflow-wrap: anywhere }
</style>

<script lang="ts">
    // Read the current screen aloud with the phone's own voice, only when pressed (so it never talks over a
    // screen reader). Hidden when the phone has no voice for the app's language.
    import { formatUnits } from "ethers"
    import { ui, t, statusOf, locale } from "./state.svelte"
    import { localMoney } from "../shared/place"
    import { speechText, stepOf, pickVoice } from "./speech"

    const synth = typeof speechSynthesis === "undefined" ? null : speechSynthesis
    let voices = $state<SpeechSynthesisVoice[]>(synth?.getVoices() ?? [])
    let speaking = $state(false)

    $effect(() => {
        if (!synth) return
        // Voices arrive asynchronously, and some engines install more while the page is open.
        const load = () => (voices = synth.getVoices())
        synth.addEventListener("voiceschanged", load)
        return () => synth.removeEventListener("voiceschanged", load)
    })
    const voice = $derived(pickVoice(voices, ui.lang, ui.country))
    const step = $derived(stepOf(ui))

    function stop() {
        synth?.cancel()
        speaking = false
    }
    // A new language or a new screen makes what is being read stale.
    $effect(() => {
        void ui.lang, step
        return stop
    })

    function text() {
        const s = ui.snap
        const amount = ui.paid?.amount ?? (s ? formatUnits(BigInt(s.amount), s.dec) : undefined)
        return speechText(step!, t, {
            program: s?.meta.name,
            amount,
            // Spoken with the currency's name ("18.055 rupias indonesias"), not its code.
            money: amount ? localMoney(Number(amount), ui.country, ui.fx, locale(), "name")?.text : null,
            status: statusOf(s),
            message: ui.cardMsg ? t(ui.cardMsg.key) : undefined,
            canClaim: !!ui.pay
        })
    }

    function toggle() {
        if (speaking || !synth || !voice || !step) return stop()
        synth.cancel()
        const u = new SpeechSynthesisUtterance(text())
        u.voice = voice
        u.lang = voice.lang
        u.rate = 0.9 // a little slower than default: clearer for a first listen
        u.onend = u.onerror = () => (speaking = false)
        synth.speak(u)
        speaking = true
    }
</script>

{#if voice && step}
    <button class="link read" type="button" aria-pressed={speaking} onclick={toggle}><span aria-hidden="true">{speaking ? "⏹" : "🔊"}</span> {t("readAloud")}</button>
{/if}

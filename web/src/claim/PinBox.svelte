<script lang="ts">
    // A PIN-locked card: decrypted on this phone; v2 cards ask the relayer's OPRF, which counts tries per card.
    import { t } from "./state.svelte"
    import { tryPin } from "./flow"

    let pin = $state("")
    let busy = $state(false), locked = $state(false)
    let msg = $state<{ text: string; bad: boolean } | null>(null)
    let input: HTMLInputElement

    $effect(() => input.focus())

    async function go() {
        input.setCustomValidity("")
        if (!/^[0-9]{6}$/.test(pin.trim())) return input.setCustomValidity(t("pinFormat")), input.reportValidity()
        busy = true
        msg = { text: t("checking"), bad: false }
        const r = await tryPin(pin.trim())
        if (r) {
            msg = { text: t(r.why) + (r.why === "pinBad" && r.left != null ? " " + t("pinLeft")(r.left) : ""), bad: true }
            locked = r.why === "pinLocked"
        }
        busy = false
    }
</script>

<section class="card">
    <label for="pin">{t("pinTitle")}</label>
    <input type="password" id="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" bind:value={pin} bind:this={input} />
    <button class="primary" type="button" disabled={busy || locked} onclick={go}>{t("unlock")}</button>
    <p class="note" class:bad={msg?.bad} aria-live="polite">{msg?.text ?? ""}</p>
</section>

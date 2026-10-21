<script lang="ts">
    // Household claim app: one card per screen, steps shown as the flow in flow.ts reaches them.
    import { ui, t } from "./state.svelte"
    import { T, NATIVE } from "./i18n"
    import CardEntry from "./CardEntry.svelte"
    import PinBox from "./PinBox.svelte"
    import ProgramCard from "./ProgramCard.svelte"
    import JoinPanel from "./JoinPanel.svelte"
    import PayChoice from "./PayChoice.svelte"
    import Paid from "./Paid.svelte"
    import Wallet from "./Wallet.svelte"
    import ReadAloud from "./ReadAloud.svelte"
    import Feedback from "./Feedback.svelte"

    $effect(() => {
        document.documentElement.lang = ui.lang
    })
    function setLang(e: Event) {
        ui.lang = (e.currentTarget as HTMLSelectElement).value
        try { localStorage.setItem("naungan-lang", ui.lang) } catch {}
    }
</script>

<main>
    <header>
        <a class="logo" href="./"><svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 9 8 2l7 7v6H1z" fill="var(--accent)" /></svg>Naungan</a>
        <select class="link" id="lang" aria-label="Language / Bahasa / ভাষা / Idioma / Lugha" value={ui.lang} onchange={setLang}>
            {#each Object.keys(T) as l (l)}<option value={l}>{NATIVE[l]}</option>{/each}
        </select>
    </header>
    <h1>{t("title")}</h1>
    <ReadAloud />

    {#if ui.nocard}<CardEntry />{/if}
    {#if ui.pin}<PinBox />{/if}
    {#if ui.program}<ProgramCard />{/if}
    {#if ui.join}<JoinPanel code={ui.join.code} card={ui.join.card} />{/if}
    {#if ui.pay}<PayChoice wallet={ui.pay.wallet} />{/if}
    {#if ui.queued}<section class="card note" id="queued" aria-live="polite">{t("queued")}</section>{/if}
    {#if ui.step}<section class="card row" aria-live="polite"><div class="spinner"></div><span>{t(ui.step)}</span></section>{/if}
    {#if ui.paid}<Paid {...ui.paid} />{/if}
    {#if ui.wallets}<Wallet funded={ui.wallets.funded} dec={ui.wallets.dec} />{/if}
    {#if ui.feedback}<Feedback />{/if}
    {#if ui.error}<section class="card note bad" role="alert">{ui.error}</section>{/if}
    <p class="privacy">{t("privacy")}</p>
</main>

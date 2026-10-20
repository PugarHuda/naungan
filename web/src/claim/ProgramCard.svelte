<script lang="ts">
    // The program this card belongs to: amount, forecast chance, claim window and what this card may do.
    import { formatUnits } from "ethers"
    import { ui, t, locale, statusOf } from "./state.svelte"
    import Money from "./Money.svelte"
    import AlertOptIn from "./AlertOptIn.svelte"

    const s = $derived(ui.snap)
    const deadline = $derived(BigInt(s?.deadline ?? 0))
    const open = $derived(deadline > 0n && Date.now() / 1000 <= Number(deadline))
    const amount = $derived(s ? formatUnits(BigInt(s.amount), s.dec) : null)
    const status = $derived(statusOf(s))
</script>

<section class="card">
    <dl>
        <dt>{t("program")}</dt><dd>{s?.meta.name ?? "…"}</dd>
        <dt>{t("amount")}</dt><dd>{amount ? `${amount} USDC` : "–"} {#if amount}<Money usdc={amount} />{/if}</dd>
        <dt>{t("chance")}</dt><dd>{s ? t("chanceOf")(s.lastIndex, s.threshold) : "–"}</dd>
    </dl>
    <p style="margin:14px 0 0"><span class="pill" class:on={open}>{status}</span></p>
    {#if s?.offline}<p class="offline" role="status">{t("offline")} {new Date(s.at).toLocaleString(locale())}</p>{/if}
    <p class="note {ui.cardMsg ? (ui.cardMsg.ok ? 'ok' : 'bad') : ''}" aria-live="polite">{ui.cardMsg ? t(ui.cardMsg.key) : ""}</p>
    {#if ui.another}
        <!-- the hashchange listener reloads into the empty card form -->
        <button class="link" type="button" style="margin-top:12px" onclick={() => (location.hash = "new")}>{t("another")}</button>
    {/if}
    {#if ui.alerts && s}<AlertOptIn snap={s} />{/if}
</section>

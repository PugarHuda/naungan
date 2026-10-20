<script lang="ts">
    // The payout went through: amount, the address it went to, and the transaction on the explorer.
    import { deployment as d } from "../shared/chain"
    import { t } from "./state.svelte"
    import Money from "./Money.svelte"

    let { txHash, payout, amount }: { txHash: string; payout: string; amount: string } = $props()
</script>

<section class="card">
    <span class="pill">{t("done")}</span>
    <div class="big">{amount} USDC</div>
    <div><Money usdc={amount} /></div>
    <div class="to">{t("balance")} {payout}</div>
    <a id="txlink" target="_blank" rel="noopener" href={d.explorer ? `${d.explorer}/tx/${txHash}` : "#"}>{d.explorer ? t("tx") : txHash}</a>
</section>

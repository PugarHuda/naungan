<script lang="ts">
    // A USDC amount in the program country's currency (≈ ৳124), in the household's language; nothing for dollar countries.
    import { localMoney } from "../shared/place"
    import { ui, t, locale } from "./state.svelte"

    let { usdc }: { usdc: string } = $props()
    const m = $derived(localMoney(Number(usdc), ui.country, ui.fx, locale()))
</script>

{#if m}<span class="idr" title={t("fxNote")(m.day.toLocaleDateString(locale()), m.currency)}>{m.text}</span>{/if}

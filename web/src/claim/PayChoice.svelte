<script lang="ts">
    // Where the money goes: a fresh wallet on this phone (default) or the household's own address.
    import { getAddress, type Wallet, type HDNodeWallet } from "ethers"
    import { t } from "./state.svelte"
    import { claim } from "./flow"

    let { wallet }: { wallet: Wallet | HDNodeWallet } = $props()
    let mode = $state<"new" | "own">("new")
    let own = $state("")
    // The backup key only appears on request: it controls the money, and screens get photographed.
    let showKey = $state(false)
    let busy = $state(false)
    let input = $state<HTMLInputElement>()!

    function pick(m: "new" | "own") {
        mode = m
        own = ""
        showKey = false
    }

    async function go() {
        let payout: string
        try {
            payout = getAddress((mode === "new" ? wallet.address : own).trim())
        } catch {
            input.setCustomValidity(t("addr")), input.reportValidity()
            return
        }
        input.setCustomValidity("")
        busy = true
        if (!(await claim(payout))) busy = false
    }
</script>

<section class="card">
    <strong>{t("payTo")}</strong>
    <label class="opt"><input type="radio" name="mode" checked={mode === "new"} onchange={() => pick("new")} /> <span>{t("newWallet")}</span></label>
    <label class="opt"><input type="radio" name="mode" checked={mode === "own"} onchange={() => pick("own")} /> <span>{t("ownWallet")}</span></label>
    {#if mode === "new"}
        <input type="text" autocomplete="off" spellcheck="false" aria-label="wallet address" readonly value={wallet.address} bind:this={input} />
        <div class="backup">
            <span>{t("backup")}</span>
            {#if showKey}<code>{wallet.privateKey}</code>{:else}<button class="link" id="showKey" type="button" onclick={() => (showKey = true)}>{t("showKey")}</button>{/if}
        </div>
    {:else}
        <input type="text" autocomplete="off" spellcheck="false" aria-label="wallet address" placeholder={t("addr")} bind:value={own} bind:this={input} />
    {/if}
    <button class="primary" type="button" disabled={busy} onclick={go}>{t("claim")}</button>
</section>

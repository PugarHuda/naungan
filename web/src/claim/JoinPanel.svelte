<script lang="ts">
    // Self-registration: the code the agency scans into its list (no name, cannot claim), plus a backup card.
    import QRCode from "qrcode"
    import { t } from "./state.svelte"

    let { code, card }: { code: string; card: string } = $props()
    // qrcode renders our own text into SVG markup; nothing from the chain or the user goes in.
    const svg = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
    let backup = $state<Promise<string> | null>(null)
</script>

<section class="card" aria-labelledby="joinH">
    <strong id="joinH">{t("joinTitle")}</strong>
    <p class="privacy">{t("joinHow")}</p>
    <div class="qr" role="img" aria-label="Registration code for the agency">{#await svg(code) then s}{@html s}{/await}</div>
    <p class="to" id="joinCode">{code}</p>
    {#if backup}
        <div>
            <p class="backup">{t("joinBackupWarn")}</p>
            <div class="qr" role="img" aria-label="Backup claim card">{#await backup then s}{@html s}{/await}</div>
        </div>
    {:else}
        <button class="link" type="button" onclick={() => (backup = svg(`${location.origin}${location.pathname}#${card}`))}>{t("joinBackupBtn")}</button>
    {/if}
</section>

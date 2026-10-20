<script lang="ts" module>
    // Chrome grants background sync only to an installed app: keep its install prompt for the alert button.
    let installPrompt: any = null
    window.addEventListener("beforeinstallprompt", (e) => (e.preventDefault(), (installPrompt = e)))
</script>

<script lang="ts">
    // Opt-in hazard alert: the service worker polls this program in the background (see sw.js) and raises a
    // local notification when claims open. No push server ever learns which phones belong to beneficiaries.
    import { deployment as d } from "../shared/chain"
    import { ui, card, store, t, type Snapshot } from "./state.svelte"
    import { SAVED } from "./flow"

    let { snap }: { snap: Snapshot } = $props()
    const flag = `naungan-alert-${d.naungan}-${card.pid}`
    let msg = $state<string | null>(store.get(flag) ? "alertOn" : null)

    async function go() {
        const reg: any = await navigator.serviceWorker?.ready
        if (!reg || !("periodicSync" in reg) || !("Notification" in window)) return (msg = "alertNo")
        if ((await Notification.requestPermission()) !== "granted") return (msg = "alertDenied")
        const register = () => reg.periodicSync.register("naungan-watch", { minInterval: 6 * 3600e3 }) // the browser may stretch it by engagement
        try {
            await register()
        } catch {
            if (!installPrompt) return (msg = "alertInstall") // no prompt offered (already dismissed, iOS…): explain the menu route
            installPrompt.prompt()
            const { outcome } = await installPrompt.userChoice
            installPrompt = null
            if (outcome !== "accepted") return (msg = "alertInstall")
            try { await register() } catch { return (msg = "alertInstall") }
        }
        reg.active.postMessage({ type: "watch", watch: { rpc: d.rpc, naungan: d.naungan, pid: card.pid!.toString(), lang: ui.lang, name: snap.meta.name, hazard: snap.meta.hazard } })
        try { localStorage.setItem(SAVED, card.fragment) } catch {}
        store.set(flag, true)
        msg = "alertOn"
    }
</script>

<div>
    {#if msg !== "alertOn"}<button class="link" type="button" onclick={go}>{t("alertBtn")}</button>{/if}
    <p class="note" aria-live="polite">{msg ? t(msg) : ""}</p>
</div>

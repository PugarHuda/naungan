<script lang="ts" module>
    // Chrome grants background sync only to an installed app: keep its install prompt for the alert button.
    let installPrompt: any = null
    window.addEventListener("beforeinstallprompt", (e) => (e.preventDefault(), (installPrompt = e)))
</script>

<script lang="ts">
    // Opt-in hazard alert, woken two ways (see sw.js): a payload-free Web Push from the relayer when the trigger
    // fires, and Periodic Background Sync where the browser grants it. The relayer keeps only this phone's push
    // endpoint for this program id (no card, no identity) and forgets it once it has sent the one push.
    import { deployment as d } from "../shared/chain"
    import { ui, card, store, t, type Snapshot } from "./state.svelte"
    import { SAVED, RELAYER } from "./flow"

    let { snap }: { snap: Snapshot } = $props()
    const flag = `naungan-alert-${d.naungan}-${card.pid}`
    let msg = $state<string | null>(store.get(flag) ? "alertOn" : null)

    const bytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

    /** Web Push subscription handed to the relayer for this program; false where push is missing or refused. */
    async function subscribePush(reg: any): Promise<boolean> {
        if (!reg.pushManager) return false // iOS Safari outside an installed home-screen app
        try {
            const key = bytes((await (await fetch(`${RELAYER}/push-key`)).json()).key)
            let sub = await reg.pushManager.getSubscription()
            const same = sub && new Uint8Array(sub.options.applicationServerKey ?? []).every((b: number, i: number) => b === key[i])
            if (sub && !same) await sub.unsubscribe(), (sub = null) // the relayer key was rotated
            sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
            const r = await fetch(`${RELAYER}/subscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programId: card.pid!.toString(), endpoint: sub.endpoint }) })
            return r.ok
        } catch {
            return false
        }
    }

    async function go() {
        const reg: any = await navigator.serviceWorker?.ready
        // iOS Safari offers push only to a home-screen app (iOS 16.4+), and its Share sheet is the only way to add one.
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
        if (ios && !standalone && !reg?.pushManager) return (msg = "alertIos")
        if (!reg || !("Notification" in window) || !(reg.pushManager || "periodicSync" in reg)) return (msg = "alertNo")
        if ((await Notification.requestPermission()) !== "granted") return (msg = "alertDenied")
        const pushed = await subscribePush(reg)
        const register = () => reg.periodicSync.register("naungan-watch", { minInterval: 6 * 3600e3 }) // the browser may stretch it by engagement
        try {
            if (!("periodicSync" in reg)) throw new Error("no periodic sync")
            await register()
        } catch {
            // Push alone is enough; without it, background sync is the only way, and Chrome grants it to installed apps.
            if (!pushed) {
                if (!installPrompt) return (msg = "alertInstall") // no prompt offered (already dismissed, iOS…): explain the menu route
                installPrompt.prompt()
                const { outcome } = await installPrompt.userChoice
                installPrompt = null
                if (outcome !== "accepted") return (msg = "alertInstall")
                try { await register() } catch { return (msg = "alertInstall") }
            }
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

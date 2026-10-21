// Offline support for the household claim app. Signal drops exactly when floods hit, so the app,
// the Semaphore proving keys and the last deployment info are served from cache when offline.
const SHELL = "naungan-shell-v9"
const ARTIFACTS = "naungan-artifacts-v1" // proving keys are immutable per version: cache forever
const WATCH = "naungan-watch" // programs this phone waits on: chain address + program id only, no identity
const PRECACHE = ["claim", "claim.js", "manifest.webmanifest", "icon.svg", "deployment.json"]

self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())))
self.addEventListener("activate", (e) =>
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, ARTIFACTS, WATCH].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
)

async function cacheFirst(req) {
    const hit = await caches.match(req)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok) (await caches.open(ARTIFACTS)).put(req, res.clone())
    return res
}

// Network first so a redeploy or a new app version is picked up, cache when the network is gone.
async function networkFirst(req) {
    try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone())
        return res
    } catch {
        // ignoreVary: module scripts are fetched with an Origin header, and a "Vary: Origin" answer would miss offline
        // A card printed before clean URLs (claim.html#…) opens the same cached page: offline it cannot follow the redirect.
        const old = req.mode === "navigate" && new URL(req.url).pathname.endsWith("/claim.html")
        const hit = await caches.match(old ? "claim" : req, { ignoreSearch: true, ignoreVary: true })
        if (hit) return hit
        throw new Error("offline and not cached")
    }
}

// Hazard alerts, two ways to wake: Periodic Background Sync (the phone polls the chain itself, no server; only
// installed Chromium apps, at a rate the browser picks) and a payload-free Web Push from the relayer's /notify
// (any browser with push). Either way the notification is written here, from the chain, in the language the household chose.
const NOTE = {
    en: (name, hz) => ({ title: `${{ heat: "Heatwave", wind: "Cyclone" }[hz] ?? "Flood"} alert: claims are open`, body: `${name}: open Naungan and tap Claim before the window closes.` }),
    id: (name, hz) => ({ title: `Peringatan ${{ heat: "gelombang panas", wind: "siklon" }[hz] ?? "banjir"}: klaim dibuka`, body: `${name}: buka Naungan dan tekan Klaim sebelum masa klaim berakhir.` }),
    bn: (name, hz) => ({ title: `${{ heat: "তাপপ্রবাহ", wind: "ঘূর্ণিঝড়" }[hz] ?? "বন্যা"} সতর্কতা: দাবি খোলা হয়েছে`, body: `${name}: নাউঙ্গান খুলুন এবং সময় শেষ হওয়ার আগে "দাবি করুন" চাপুন।` }),
    es: (name, hz) => ({ title: `Alerta de ${{ heat: "ola de calor", wind: "ciclón" }[hz] ?? "inundación"}: reclamos abiertos`, body: `${name}: abra Naungan y toque Reclamar antes de que termine el plazo.` }),
    sw: (name, hz) => ({ title: `Tahadhari ya ${{ heat: "wimbi la joto", wind: "kimbunga" }[hz] ?? "mafuriko"}: madai yamefunguliwa`, body: `${name}: fungua Naungan na ubonyeze Dai kabla muda haujaisha.` }),
    pt: (name, hz) => ({ title: `Alerta de ${{ heat: "onda de calor", wind: "ciclone" }[hz] ?? "cheia"}: pedidos abertos`, body: `${name}: abra o Naungan e toque em Pedir antes de o prazo terminar.` }),
    fil: (name, hz) => ({ title: `Babala sa ${{ heat: "matinding init", wind: "bagyo" }[hz] ?? "baha"}: bukas na ang pag-claim`, body: `${name}: buksan ang Naungan at pindutin ang I-claim bago magsara ang panahon ng pag-claim.` })
}
const watchKey = (w) => `/__watch__/${w.naungan}/${w.pid}`

/** claimDeadline of programs(pid) via a raw eth_call (word 6 of the returned struct); 0 = not triggered. */
async function deadline(w) {
    const data = "0x92db2816" + BigInt(w.pid).toString(16).padStart(64, "0") // programs(uint256)
    const r = await (await fetch(w.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: w.naungan, data }, "latest"] }) })).json()
    if (r.error || !r.result || r.result.length < 2 + 64 * 7) throw new Error(r.error?.message ?? "bad eth_call result")
    return BigInt("0x" + r.result.slice(2 + 64 * 6, 2 + 64 * 7))
}

async function checkWatches() {
    let shown = 0
    const cache = await caches.open(WATCH)
    const now = BigInt(Math.floor(Date.now() / 1000))
    for (const req of await cache.keys()) {
        const w = await (await cache.match(req)).json()
        let end
        try { end = await deadline(w) } catch { continue } // no signal: try at the next sync
        if (end === 0n) continue
        if (now > end) { await cache.delete(req); continue } // window over: stop watching
        if (w.notified) continue
        const n = (NOTE[w.lang] ?? NOTE.en)(w.name, w.hazard)
        try {
            await self.registration.showNotification(n.title, { body: n.body, tag: watchKey(w), icon: "icon.svg", badge: "icon.svg", requireInteraction: true, data: { url: "claim" } })
        } catch { continue } // permission revoked: leave it un-notified so a later grant still alerts, and check the rest
        await cache.put(req, new Response(JSON.stringify({ ...w, notified: true })))
        shown++
    }
    return shown
}

// The relayer pushes only when a watched program's claims opened. Browsers require a notification for every push,
// so if the chain read failed (no signal, a lagging RPC node), say so in general terms rather than show nothing.
self.addEventListener("push", (e) => e.waitUntil((async () => {
    if (await checkWatches().catch(() => 0)) return
    const w = await (async () => { const c = await caches.open(WATCH); const k = (await c.keys())[0]; return k && (await c.match(k)).json() })().catch(() => null)
    const n = (NOTE[w?.lang] ?? NOTE.en)(w?.name ?? "Naungan", w?.hazard)
    await self.registration.showNotification(n.title, { body: n.body, tag: "naungan-push", icon: "icon.svg", badge: "icon.svg", data: { url: "claim" } })
})()))

self.addEventListener("periodicsync", (e) => { if (e.tag === "naungan-watch") e.waitUntil(checkWatches()) })

self.addEventListener("notificationclick", (e) => {
    e.notification.close()
    e.waitUntil((async () => {
        const open = (await self.clients.matchAll({ type: "window" })).find((c) => /\/claim(\.html)?$/.test(new URL(c.url).pathname))
        return open ? open.focus() : self.clients.openWindow(e.notification.data?.url ?? "claim")
    })())
})

self.addEventListener("message", (e) => {
    // The page asks for the proving keys it will need, while it still has signal.
    if (e.data?.type === "prefetch") e.waitUntil(Promise.all(e.data.urls.map((u) => cacheFirst(new Request(u)).catch(() => null))))
    if (e.data?.type === "watch") e.waitUntil(caches.open(WATCH).then((c) => c.put(watchKey(e.data.watch), new Response(JSON.stringify(e.data.watch)))).then(checkWatches))
    if (e.data?.type === "unwatch") e.waitUntil(caches.open(WATCH).then((c) => c.delete(watchKey(e.data.watch))))
})

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url)
    if (e.request.method !== "GET") return // RPC calls and relayer submissions always go to the network
    if (url.hostname === "snark-artifacts.pse.dev") return e.respondWith(cacheFirst(e.request))
    if (url.origin === location.origin) e.respondWith(networkFirst(e.request))
})

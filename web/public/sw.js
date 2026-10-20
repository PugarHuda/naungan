// Offline support for the household claim app. Signal drops exactly when floods hit, so the app,
// the Semaphore proving keys and the last deployment info are served from cache when offline.
const SHELL = "naungan-shell-v8"
const ARTIFACTS = "naungan-artifacts-v1" // proving keys are immutable per version: cache forever
const WATCH = "naungan-watch" // programs this phone waits on: chain address + program id only, no identity
const PRECACHE = ["claim.html", "claim.js", "manifest.webmanifest", "icon.svg", "deployment.json"]

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
        const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true })
        if (hit) return hit
        throw new Error("offline and not cached")
    }
}

// Flood alerts without a push server: the phone itself polls the chain in the background (Periodic
// Background Sync) and shows a local notification when claims open. Web Push would need a server
// that keeps every enrolled phone's subscription and lets the push service know who is a beneficiary.
const NOTE = {
    en: (name, heat) => ({ title: `${heat ? "Heatwave" : "Flood"} alert: claims are open`, body: `${name}: open Naungan and tap Claim before the window closes.` }),
    id: (name, heat) => ({ title: `Peringatan ${heat ? "gelombang panas" : "banjir"}: klaim dibuka`, body: `${name}: buka Naungan dan tekan Klaim sebelum masa klaim berakhir.` }),
    bn: (name, heat) => ({ title: `${heat ? "তাপপ্রবাহ" : "বন্যা"} সতর্কতা: দাবি খোলা হয়েছে`, body: `${name}: নাউঙ্গান খুলুন এবং সময় শেষ হওয়ার আগে "দাবি করুন" চাপুন।` }),
    es: (name, heat) => ({ title: `Alerta de ${heat ? "ola de calor" : "inundación"}: reclamos abiertos`, body: `${name}: abra Naungan y toque Reclamar antes de que termine el plazo.` }),
    sw: (name, heat) => ({ title: `Tahadhari ya ${heat ? "wimbi la joto" : "mafuriko"}: madai yamefunguliwa`, body: `${name}: fungua Naungan na ubonyeze Dai kabla muda haujaisha.` })
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
    const cache = await caches.open(WATCH)
    const now = BigInt(Math.floor(Date.now() / 1000))
    for (const req of await cache.keys()) {
        const w = await (await cache.match(req)).json()
        let end
        try { end = await deadline(w) } catch { continue } // no signal: try at the next sync
        if (end === 0n) continue
        if (now > end) { await cache.delete(req); continue } // window over: stop watching
        if (w.notified) continue
        const n = (NOTE[w.lang] ?? NOTE.en)(w.name, w.hazard === "heat")
        try {
            await self.registration.showNotification(n.title, { body: n.body, tag: watchKey(w), icon: "icon.svg", badge: "icon.svg", requireInteraction: true, data: { url: "claim.html" } })
        } catch { continue } // permission revoked: leave it un-notified so a later grant still alerts, and check the rest
        await cache.put(req, new Response(JSON.stringify({ ...w, notified: true })))
    }
}

self.addEventListener("periodicsync", (e) => { if (e.tag === "naungan-watch") e.waitUntil(checkWatches()) })

self.addEventListener("notificationclick", (e) => {
    e.notification.close()
    e.waitUntil((async () => {
        const open = (await self.clients.matchAll({ type: "window" })).find((c) => new URL(c.url).pathname.endsWith("/claim.html"))
        return open ? open.focus() : self.clients.openWindow(e.notification.data?.url ?? "claim.html")
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

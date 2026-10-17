// Offline support for the household claim app. Signal drops exactly when floods hit, so the app,
// the Semaphore proving keys and the last deployment info are served from cache when offline.
const SHELL = "naungan-shell-v2"
const ARTIFACTS = "naungan-artifacts-v1" // proving keys are immutable per version: cache forever
const PRECACHE = ["claim.html", "claim.js", "manifest.webmanifest", "icon.svg", "deployment.json"]

self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())))
self.addEventListener("activate", (e) =>
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, ARTIFACTS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
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
        const hit = await caches.match(req, { ignoreSearch: true })
        if (hit) return hit
        throw new Error("offline and not cached")
    }
}

self.addEventListener("message", (e) => {
    // The page asks for the proving keys it will need, while it still has signal.
    if (e.data?.type === "prefetch") e.waitUntil(Promise.all(e.data.urls.map((u) => cacheFirst(new Request(u)).catch(() => null))))
})

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url)
    if (e.request.method !== "GET") return // RPC calls and relayer submissions always go to the network
    if (url.hostname === "snark-artifacts.pse.dev") return e.respondWith(cacheFirst(e.request))
    if (url.origin === location.origin) e.respondWith(networkFirst(e.request))
})

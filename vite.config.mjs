// Web apps: Vite + Svelte 5, three pages (landing, dashboard, claim) that keep their public URLs, so printed
// claim cards (claim.html#…) and links in the wild keep working. `npm run dev` serves, `npm run build`
// writes dist/ for Vercel.
import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const web = resolve(import.meta.dirname, "web")
const out = resolve(import.meta.dirname, "dist")

/**
 * The claim app must open, and prove, with no signal, so the service worker precaches its shell. Hashed
 * file names change every build: walk the claim entry's chunk graph (static and dynamic imports, so the
 * lazily loaded prover and PIN code are in it, and the dashboard's or landing's chunks are not) and write
 * that list into sw.js, naming the cache after it so a new build replaces the old shell.
 */
function precacheClaimShell() {
    let files = null
    return {
        name: "naungan-precache",
        apply: "build",
        generateBundle(_, bundle) {
            const entry = Object.values(bundle).find((c) => c.type === "chunk" && c.isEntry && c.name === "claim")
            if (!entry) throw new Error("precache: no claim entry chunk")
            const seen = new Set()
            const walk = (name) => {
                const c = bundle[name]
                // The world's borders (230 kB) are fetched only for an old program without a country in its metadata,
                // once, then remembered: not worth every phone's data plan at install.
                if (!c || c.type !== "chunk" || seen.has(name) || c.name === "country-coder") return
                seen.add(name)
                for (const css of c.viteMetadata?.importedCss ?? []) seen.add(css)
                for (const n of [...c.imports, ...c.dynamicImports]) walk(n)
            }
            walk(entry.fileName)
            files = ["claim", ...[...seen].sort(), "manifest.webmanifest", "icon.svg"] // "claim": the clean URL Vercel serves (cleanUrls)
        },
        closeBundle() {
            const version = createHash("sha256").update(files.join()).digest("hex").slice(0, 10)
            const sw = resolve(out, "sw.js")
            const src = readFileSync(sw, "utf8")
            const next = src.replace(/const SHELL = "[^"]*"/, `const SHELL = "naungan-shell-${version}"`).replace(/const PRECACHE = \[[^\]]*\]/, `const PRECACHE = ${JSON.stringify(files)}`)
            if (next === src) throw new Error("sw.js: SHELL / PRECACHE lines not found")
            writeFileSync(sw, next)
        }
    }
}

/**
 * vercel.json's headers on `vite preview` (and so on the e2e suite), applied as Vercel does: every rule whose
 * source matches the path, in order, a later rule overriding a header an earlier one set. HSTS and
 * upgrade-insecure-requests are dropped: preview is plain http://localhost.
 */
function vercelHeaders() {
    const rules = JSON.parse(readFileSync(resolve(import.meta.dirname, "vercel.json"), "utf8")).headers.map((r) => ({ re: new RegExp(`^${r.source}$`), headers: r.headers }))
    return {
        name: "naungan-vercel-headers",
        configurePreviewServer(server) {
            server.middlewares.use((req, res, next) => {
                const path = new URL(req.url, "http://x").pathname
                for (const r of rules) if (r.re.test(path)) for (const { key, value } of r.headers) if (key !== "Strict-Transport-Security") res.setHeader(key, key === "Content-Security-Policy" ? value.replace(/;\s*upgrade-insecure-requests/, "") : value)
                next()
            })
        }
    }
}

/** NAUNGAN_DEPLOYMENT=path bundles another deployment (a local Hardhat chain for end-to-end tests) in place of web/deployment.json. */
function deploymentOverride() {
    const file = process.env.NAUNGAN_DEPLOYMENT && resolve(process.env.NAUNGAN_DEPLOYMENT)
    return { name: "naungan-deployment", enforce: "pre", resolveId: (id) => (file && /(^|\/)deployment\.json$/.test(id) ? file : null) }
}

export default defineConfig({
    root: web,
    plugins: [deploymentOverride(), svelte(), precacheClaimShell(), vercelHeaders()],
    server: { port: 5173 },
    preview: { port: 5173 },
    worker: { format: "es" }, // the dedup worker imports lib/psi.mjs and its curve library as modules
    build: {
        outDir: out,
        emptyOutDir: true,
        target: "es2022",
        chunkSizeWarningLimit: 4000, // the claim app carries Semaphore + snarkjs; it is proved on the phone
        rollupOptions: { input: { index: resolve(web, "index.html"), dashboard: resolve(web, "dashboard.html"), claim: resolve(web, "claim.html"), launch: resolve(web, "launch.html"), embed: resolve(web, "embed.html"), enroll: resolve(web, "enroll.html"), dedup: resolve(web, "dedup.html"), poster: resolve(web, "poster.html") } }
    }
})

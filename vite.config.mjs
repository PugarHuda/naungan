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
                if (!c || c.type !== "chunk" || seen.has(name)) return
                seen.add(name)
                for (const css of c.viteMetadata?.importedCss ?? []) seen.add(css)
                for (const n of [...c.imports, ...c.dynamicImports]) walk(n)
            }
            walk(entry.fileName)
            files = ["claim.html", ...[...seen].sort(), "manifest.webmanifest", "icon.svg"]
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

/** NAUNGAN_DEPLOYMENT=path bundles another deployment (a local Hardhat chain for end-to-end tests) in place of web/deployment.json. */
function deploymentOverride() {
    const file = process.env.NAUNGAN_DEPLOYMENT && resolve(process.env.NAUNGAN_DEPLOYMENT)
    return { name: "naungan-deployment", enforce: "pre", resolveId: (id) => (file && /(^|\/)deployment\.json$/.test(id) ? file : null) }
}

export default defineConfig({
    root: web,
    plugins: [deploymentOverride(), svelte(), precacheClaimShell()],
    server: { port: 5173 },
    preview: { port: 5173 },
    build: {
        outDir: out,
        emptyOutDir: true,
        target: "es2022",
        chunkSizeWarningLimit: 4000, // the claim app carries Semaphore + snarkjs; it is proved on the phone
        rollupOptions: { input: { index: resolve(web, "index.html"), dashboard: resolve(web, "dashboard.html"), claim: resolve(web, "claim.html"), launch: resolve(web, "launch.html") } }
    }
})

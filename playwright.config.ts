// End-to-end suite: the production build on `vite preview`, served with vercel.json's security headers, against
// the live chain and data services. `npm run e2e`. Tests tagged @phone run only at 360 px, @desktop only at 1280 px.
import { defineConfig, devices } from "@playwright/test"

const CI = !!process.env.CI

export default defineConfig({
    testDir: "e2e",
    testMatch: "*.e2e.ts",
    timeout: 150_000, // live RPC, Open-Meteo and in-browser Groth16 proving
    expect: { timeout: 45_000 },
    retries: CI ? 2 : 0,
    workers: 2, // the free tiers of Open-Meteo and Blockscout rate-limit quickly
    reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://localhost:4173",
        locale: "en-US",
        trace: "retain-on-failure",
        // A service worker handles requests before Playwright's routing sees them, which would let the money
        // guard in fixtures.ts be bypassed. Tests that need the worker (offline) opt back in.
        serviceWorkers: "block"
    },
    webServer: {
        command: "npm run build && npx vite preview --port 4173 --strictPort",
        url: "http://localhost:4173/claim.html",
        reuseExistingServer: !CI,
        timeout: 240_000
    },
    projects: [
        { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } }, grepInvert: /@desktop/ },
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, grepInvert: /@phone/ }
    ]
})

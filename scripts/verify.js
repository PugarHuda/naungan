#!/usr/bin/env node
// Verify the deployed Naungan source on Sourcify (API v2; hardhat-verify still calls the removed v1).
//   node scripts/verify.js            reads web/deployment.json
const fs = require("fs")
const path = require("path")
const { ROOT, deployment } = require("../lib/chain")

const API = "https://sourcify.dev/server"
const HEADERS = { "content-type": "application/json", "user-agent": "naungan-verify (github.com/PugarHuda/naungan)" }

async function main() {
    const d = deployment()
    // The artifact's .dbg.json names the exact compilation the deployed bytecode came from.
    const dbg = path.join(ROOT, "artifacts/contracts/Naungan.sol/Naungan.dbg.json")
    if (!fs.existsSync(dbg)) throw new Error("no Naungan artifact: run `npx hardhat compile` first")
    const info = JSON.parse(fs.readFileSync(path.resolve(path.dirname(dbg), JSON.parse(fs.readFileSync(dbg, "utf8")).buildInfo), "utf8"))
    const res = await fetch(`${API}/v2/verify/${d.chainId}/${d.naungan}`, {
        method: "POST", headers: HEADERS,
        body: JSON.stringify({ stdJsonInput: info.input, compilerVersion: info.solcLongVersion, contractIdentifier: "contracts/Naungan.sol:Naungan" })
    })
    const job = await res.json()
    if (!res.ok) throw new Error(job.message ?? JSON.stringify(job))
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const s = await (await fetch(`${API}/v2/verify/${job.verificationId}`, { headers: HEADERS })).json()
        if (!s.isJobCompleted) continue
        if (s.error) throw new Error(s.error.message ?? JSON.stringify(s.error))
        console.log(`verified (${s.contract.match ?? s.contract.runtimeMatch}) · https://repo.sourcify.dev/${d.chainId}/${d.naungan}`)
        return
    }
    throw new Error("Sourcify job still running; check later")
}

main().catch((e) => (console.error(e.message), process.exit(1)))

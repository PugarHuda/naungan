#!/usr/bin/env node
// Program coordinator: create a flood program, manage agencies, fund, refund, inspect.
//
//   node scripts/coordinator.js create --name "Krueng Aceh flood · Banda Aceh" --lat 5.55 --lon 95.32 \
//        --return-period 5 --lead-days 10 --trigger 60 --amount 2 --claim-days 14 --season-days 180 [--oracles 0xA,0xB,0xC --quorum 2]
//   node scripts/coordinator.js add-agency    --program 1 --agency 0x..
//   node scripts/coordinator.js remove-agency --program 1 --agency 0x..
//   node scripts/coordinator.js fund          --program 1 --amount 10        (USDC, approves first)
//   node scripts/coordinator.js refund        --program 1
//   node scripts/coordinator.js status        --program 1
const { parseArgs } = require("util")
const { ethers } = require("ethers")
const { connect, abi, explain } = require("../lib/chain")

const { values: a, positionals: [cmd] } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
        ["program", "agency", "amount", "name", "lat", "lon", "return-period", "lead-days", "trigger", "claim-days", "season-days", "oracles", "quorum"].map((k) => [k, { type: "string" }])
    )
})
const need = (...k) => k.forEach((x) => { if (a[x] === undefined) throw new Error(`--${x} is required`) })
const num = (k, min, max) => {
    const v = Number(a[k])
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`--${k} must be between ${min} and ${max}`)
    return v
}
const wait = async (txp) => {
    const tx = await txp
    await tx.wait()
    return tx.hash
}

;(async () => {
    const { naungan, wallet, signer, d } = await connect()
    const usdc = new ethers.Contract(d.usdc, abi("MockUSDC"), signer) // ERC-20 subset; works for Circle USDC too
    const dec = await usdc.decimals()

    if (cmd === "create") {
        need("name", "lat", "lon", "return-period", "lead-days", "trigger", "amount", "claim-days", "season-days")
        const meta = {
            name: a.name,
            hazard: "flood",
            source: "GloFAS v4 river discharge via Open-Meteo",
            lat: num("lat", -90, 90),
            lon: num("lon", -180, 180),
            returnPeriod: num("return-period", 1.1, 100),
            leadDays: num("lead-days", 1, 30),
            unit: "% of ensemble members above the return-period flood"
        }
        const oracleList = (a.oracles ?? wallet.address).split(",").map((x) => ethers.getAddress(x.trim()))
        const quorum = a.quorum ? num("quorum", 1, oracleList.length) : 1
        const now = (await wallet.provider.getBlock("latest")).timestamp
        const hash = await wait(naungan.createProgram(
            oracleList,
            quorum,
            ethers.parseUnits(a.amount, dec),
            num("trigger", 1, 100),
            Math.round(num("claim-days", 0.01, 365) * 86400),
            now + Math.round(num("season-days", 1, 3650) * 86400),
            JSON.stringify(meta)
        ))
        return console.log(`program ${await naungan.programCount()} created · ${hash}`)
    }

    if (cmd === "mint") {
        // Local dev chain only: Circle USDC on testnets comes from faucet.circle.com instead.
        if (d.usdcIsCircle || d.chainId !== 31337) throw new Error("mint only exists for the local MockUSDC; use faucet.circle.com on testnets")
        need("amount")
        return console.log(`minted ${a.amount} test USDC · ${await wait(usdc.mint(wallet.address, ethers.parseUnits(a.amount, dec)))}`)
    }

    need("program")
    const pid = BigInt(a.program)
    if (cmd === "add-agency" || cmd === "remove-agency") {
        need("agency")
        const fn = cmd === "add-agency" ? naungan.addAgency : naungan.removeAgency
        return console.log(`${cmd} ${ethers.getAddress(a.agency)} · ${await wait(fn(pid, a.agency))}`)
    }
    if (cmd === "fund") {
        need("amount")
        const amt = ethers.parseUnits(a.amount, dec)
        const bal = await usdc.balanceOf(wallet.address)
        if (bal < amt) throw new Error(`need ${a.amount} USDC, have ${ethers.formatUnits(bal, dec)} (Base Sepolia: faucet.circle.com)`)
        if ((await usdc.allowance(wallet.address, d.naungan)) < amt) await wait(usdc.approve(d.naungan, amt))
        return console.log(`funded ${a.amount} USDC · ${await wait(naungan.fund(pid, amt))}`)
    }
    if (cmd === "refund") return console.log(`refunded · ${await wait(naungan.refundUnclaimed(pid))}`)
    if (cmd === "status") {
        const p = await naungan.programs(pid)
        const f = (x) => ethers.formatUnits(x, dec)
        return console.log({
            ...JSON.parse(await naungan.metadata(pid)),
            enrolled: Number(p.enrolled),
            claims: Number(p.claims),
            perHousehold: f(p.amountPerHousehold),
            funded: f(p.funded),
            lastIndex: Number(p.lastIndex),
            trigger: Number(p.triggerThreshold),
            claimsOpenUntil: p.claimDeadline ? new Date(Number(p.claimDeadline) * 1000).toISOString() : null,
            seasonEnd: new Date(Number(p.seasonEnd) * 1000).toISOString()
        })
    }
    throw new Error("usage: coordinator.js create|add-agency|remove-agency|fund|refund|status ...")
})().catch((e) => {
    console.error(explain(e))
    process.exitCode = 1
})

#!/usr/bin/env node
// Program coordinator: create a flood program, manage agencies, fund, refund, inspect.
//
//   node scripts/coordinator.js create --name "Krueng Aceh flood · Banda Aceh" --lat 5.55 --lon 95.32 \
//        --return-period 5 --lead-days 10 --trigger 60 --amount 2 --claim-days 14 --season-days 180 [--oracles 0xA,0xB,0xC --quorum 2]
//        [--pipelines glofas,rain --rain-cells "5.5,95.5;5.25,95.5" --rain-return-period 2]   one pipeline per oracle
//   node scripts/coordinator.js create --hazard heat --name "Dhaka heatwave" --lat 23.81 --lon 90.41 --tmax 38 --heat-days 2 [--tmin 30]
//        --lead-days 7 --trigger 50 --amount 1 --claim-days 7 --season-days 180     (heatwave: NOAA GEFS max temperature)
//   node scripts/coordinator.js create --hazard wind --name "Tacloban typhoon wind" --lat 11.24 --lon 125.0 --return-period 10
//        --lead-days 5 --trigger 50 --amount 1 --claim-days 7 --season-days 180     (cyclone wind: GEFS peak gusts vs ERA5's 1-in-T-year gust)
//   node scripts/coordinator.js create --preset urcs-flood --snap --name "Mpologoma river flood · Butaleja, Uganda" --lat 0.93 --lon 33.95 //        --amount 0.5 --claim-days 7 --season-days 223     (trigger from a society's EAP; --snap moves to the river's main cell)
//   node scripts/coordinator.js add-agency    --program 1 --agency 0x..
//   node scripts/coordinator.js remove-agency --program 1 --agency 0x..
//   node scripts/coordinator.js fund          --program 1 --amount 10        (USDC, approves first)
//   node scripts/coordinator.js refund        --program 1        (this key's own pro-rata share, once claims are over)
//   node scripts/coordinator.js status        --program 1
const { parseArgs } = require("util")
const { PRESETS, buildMeta } = require("../lib/program.mjs")
const hazard = require("../lib/hazard.mjs")
const { ethers } = require("ethers")
const { connect, abi, explain } = require("../lib/chain")

// parseArgs reads "--lon -85.9" as two flags; a negative number after a flag is its value (the Americas, the
// southern hemisphere), so join it as "--lon=-85.9".
const argv = process.argv.slice(2), isNum = (x) => /^-\d/.test(x ?? "")
const args = argv.flatMap((x, i) => (isNum(argv[i + 1]) && /^--[^=]+$/.test(x) ? [`${x}=${argv[i + 1]}`] : isNum(x) && /^--[^=]+$/.test(argv[i - 1] ?? "") ? [] : [x]))
const { values: a, positionals: [cmd] } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
        ["program", "agency", "amount", "name", "lat", "lon", "hazard", "tmax", "tmin", "heat-days", "return-period", "lead-days", "trigger", "claim-days", "season-days", "oracles", "quorum", "pipelines", "rain-cells", "rain-return-period", "preset", "country"].map((k) => [k, { type: "string" }]).concat([["snap", { type: "boolean" }]])
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
        // --preset fills the trigger from a society's Early Action Protocol (lib/program.mjs); flags override it.
        const preset = a.preset ? PRESETS.find((x) => x.id === a.preset) : {}
        if (!preset) throw new Error(`--preset is one of ${PRESETS.map((x) => x.id).join(", ")}`)
        const pick = (flag, key) => a[flag] ?? preset[key]
        const hazardName = a.hazard ?? preset.hazard ?? "flood"
        need("name", "lat", "lon", "amount", "claim-days", "season-days")
        let lat = Number(a.lat), lon = Number(a.lon)
        if (a.snap && hazardName === "flood") {
            // The oracle reads one GloFAS cell: move to the river's main channel near the place, not a side cell.
            const cell = await hazard.riverCell(lat, lon)
            console.log(`snapped to the river cell ${cell.lat},${cell.lon} (${cell.km.toFixed(1)} km away, mean ${Math.round(cell.flow)} m3/s)`)
            ;({ lat, lon } = cell)
        }
        const oracleList = (a.oracles ?? wallet.address).split(",").map((x) => ethers.getAddress(x.trim()))
        const meta = buildMeta({
            name: a.name, hazard: hazardName, lat, lon, country: a.country,
            returnPeriod: pick("return-period", "returnPeriod"), leadDays: pick("lead-days", "leadDays"),
            tmax: pick("tmax", "tmax"), tmin: pick("tmin", "tmin"), days: pick("heat-days", "days"),
            oracles: oracleList, pipelines: a.pipelines?.split(",").map((x) => x.trim()),
            rainReturnPeriod: a["rain-return-period"], rainCells: a["rain-cells"]?.split(";").map((c) => c.split(",").map(Number))
        })
        a.trigger ??= preset.trigger
        need("trigger")
        const quorum = a.quorum ? num("quorum", 1, oracleList.length) : 1
        const now = (await wallet.provider.getBlock("latest")).timestamp
        // Read the id from the receipt: a load-balanced public RPC can answer programCount() from a stale node.
        const tx = await naungan.createProgram(
            oracleList,
            quorum,
            ethers.parseUnits(a.amount, dec),
            num("trigger", 1, 100),
            Math.round(num("claim-days", 0.01, 365) * 86400),
            now + Math.round(num("season-days", 1, 3650) * 86400),
            JSON.stringify(meta)
        )
        const pid = (await tx.wait()).logs.map((l) => naungan.interface.parseLog(l)).find((e) => e?.name === "ProgramCreated").args.programId
        return console.log(`program ${pid} created · ${tx.hash}`)
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
        if ((await usdc.allowance(wallet.address, d.naungan)) < amt) {
            await wait(usdc.approve(d.naungan, amt))
            // A load-balanced public RPC can estimate fund() on a node that has not seen the approval yet.
            for (let i = 0; (await usdc.allowance(wallet.address, d.naungan)) < amt; i++) {
                if (i === 20) throw new Error("approval mined but the RPC still reports no allowance; retry in a minute")
                await new Promise((r) => setTimeout(r, 1000))
            }
        }
        return console.log(`funded ${a.amount} USDC · ${await wait(naungan.fund(pid, amt))}`)
    }
    if (cmd === "refund") return console.log(`refunded the pro-rata share of ${ethers.formatUnits(await naungan.contributed(pid, wallet.address), dec)} USDC given · ${await wait(naungan.refund(pid))}`)
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

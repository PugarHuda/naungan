#!/usr/bin/env node
// Program coordinator: create a flood program, manage agencies, fund, refund, inspect.
//
//   node scripts/coordinator.js create --name "Krueng Aceh flood · Banda Aceh" --lat 5.55 --lon 95.32 \
//        --return-period 5 --lead-days 10 --trigger 60 --amount 2 --claim-days 14 --season-days 180 [--oracles 0xA,0xB,0xC --quorum 2]
//        [--pipelines glofas,rain --rain-cells "5.5,95.5;5.25,95.5" --rain-return-period 2]   one pipeline per oracle
//   node scripts/coordinator.js create --hazard heat --name "Dhaka heatwave" --lat 23.81 --lon 90.41 --tmax 38 --heat-days 2 [--tmin 30]
//        --lead-days 7 --trigger 50 --amount 1 --claim-days 7 --season-days 180     (heatwave: NOAA GEFS max temperature)
//   node scripts/coordinator.js add-agency    --program 1 --agency 0x..
//   node scripts/coordinator.js remove-agency --program 1 --agency 0x..
//   node scripts/coordinator.js fund          --program 1 --amount 10        (USDC, approves first)
//   node scripts/coordinator.js refund        --program 1        (this key's own pro-rata share, once claims are over)
//   node scripts/coordinator.js status        --program 1
const { parseArgs } = require("util")
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
        ["program", "agency", "amount", "name", "lat", "lon", "hazard", "tmax", "tmin", "heat-days", "return-period", "lead-days", "trigger", "claim-days", "season-days", "oracles", "quorum", "pipelines", "rain-cells", "rain-return-period"].map((k) => [k, { type: "string" }])
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
        const heat = a.hazard === "heat"
        if (a.hazard && !heat && a.hazard !== "flood") throw new Error("--hazard is flood (default) or heat")
        need("name", "lat", "lon", ...(heat ? ["tmax", "heat-days"] : ["return-period"]), "lead-days", "trigger", "amount", "claim-days", "season-days")
        const meta = heat
            ? {
                  name: a.name,
                  hazard: "heat",
                  source: "NOAA GEFS daily maximum temperature via Open-Meteo",
                  lat: num("lat", -90, 90),
                  lon: num("lon", -180, 180),
                  leadDays: num("lead-days", 1, 16), // GEFS 0.25 runs 16 days out
                  heat: { tmax: num("tmax", 25, 60), ...(a.tmin != null && { tmin: num("tmin", 10, 45) }), days: num("heat-days", 1, 10), cells: [[Number(a.lat), Number(a.lon)]] },
                  unit: "% of ensemble members forecasting a heatwave"
              }
            : {
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
        if (a.pipelines) {
            // Which forecast each oracle runs, on-chain so anyone can audit that a quorum mixes independent sources.
            const ps = a.pipelines.split(",").map((x) => x.trim())
            if (ps.length !== oracleList.length || ps.some((x) => !["glofas", "rain", "heat"].includes(x))) throw new Error("--pipelines needs one of glofas|rain|heat per oracle")
            meta.pipelines = Object.fromEntries(oracleList.map((o, i) => [o, ps[i]]))
            if (ps.includes("rain")) {
                meta.source += " + NOAA GEFS catchment rainfall vs ERA5"
                meta.rain = {
                    returnPeriod: a["rain-return-period"] ? num("rain-return-period", 1.1, 100) : meta.returnPeriod,
                    cells: (a["rain-cells"] ?? `${meta.lat},${meta.lon}`).split(";").map((c) => {
                        const [lat, lon] = c.split(",").map(Number)
                        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error(`bad --rain-cells entry "${c}"`)
                        return [lat, lon]
                    })
                }
            }
        }
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

<script lang="ts">
    // Running costs: the gas of this deployment's real claims, oracle reports, enrolments and donations, priced on Base
    // mainnet today (shared/costs.ts), and what a season of this program costs against the aid it pays.
    import { JsonRpcProvider } from "ethers"
    import { deployment as d, provider } from "../shared/chain"
    import { netName } from "./format"
    import { measure, prices, season, usdOf, REPORTS_PER_KEY_PER_YEAR, type Kind, type Measured, type Prices, type Sample } from "../shared/costs"
    import { allEvents, dash } from "./state.svelte"

    const KIND: Record<string, Kind> = { Claimed: "claim", IndexReported: "report", Enrolled: "enroll", Funded: "fund" }
    const LABEL: Record<Kind, [string, string]> = {
        claim: ["A household's claim", "proof checked on-chain, USDC paid; the relayer pays it"],
        report: ["An oracle report", "forecast value and evidence posted"],
        enroll: ["Enrolling a household", "per household, in the batches enrolled so far (a Semaphore tree insert)"],
        fund: ["A donation", "paid by the donor"]
    }
    let m = $state<Measured | null>(null)
    let p = $state<Prices | null>(null)
    let err = $state("")
    let started = false
    $effect(() => {
        if (started || !dash.current) return // wait until the history (every program's events) has been read once
        started = true
        const samples: Sample[] = allEvents().flatMap((e) => (KIND[e.fragment?.name] ? [{ kind: KIND[e.fragment.name], hash: e.transactionHash, households: e.fragment.name === "Enrolled" ? Number(e.args.households) : undefined }] : []))
        // About 20 reads from two public RPCs: one dropped request should not cost the panel, so try three times.
        const run = (left: number): Promise<void> =>
            Promise.all([measure(samples, receipts), prices()]).then(([a, b]) => void ((m = a), (p = b))).catch((e: Error) => (left > 0 ? new Promise((r) => setTimeout(r, 3000)).then(() => run(left - 1)) : void (err = e.message)))
        void run(2)
    })
    // Receipts from a wide-range history RPC when there is one, so these reads never compete with the dashboard's own on the public RPC.
    const receipts = d.logRpcs?.length ? new JsonRpcProvider(d.logRpcs[0], d.chainId, { staticNetwork: true }) : provider()
    const money = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toPrecision(2)}` : `$${v.toLocaleString("en", { maximumFractionDigits: 2 })}`)
    const scale = $derived(m && p && dash.p ? season(m, p, dash.os.length, 1000, Number(dash.p.amountPerHousehold) / 1e6) : { total: 0, perHousehold: 0 })
    const s = $derived(m && p && dash.p ? season(m, p, dash.os.length, Number(dash.p.enrolled), Number(dash.p.amountPerHousehold) / 1e6) : null)
</script>

<article class="panel" aria-labelledby="costH" id="costs">
    <h2 id="costH">Running costs</h2>
    <p class="lead-in">What this system costs to run, from its own transactions: gas measured on {netName}, priced on Base mainnet today.</p>
    {#if err}
        <p class="fine" role="status">Costs are unavailable right now ({err}).</p>
    {:else if !m || !p}
        <p class="fine" role="status">Measuring real transactions…</p>
    {:else}
        <table class="costs">
            <thead><tr><th scope="col">Action</th><th scope="col">Gas</th><th scope="col">On Base mainnet</th></tr></thead>
            <tbody>
                {#each ["claim", "report", "enroll", "fund"] as Kind[] as k (k)}
                    {#if m[k]}
                        <tr><td>{LABEL[k][0]}<small>{LABEL[k][1]}</small></td><td>{m[k]!.gas.toLocaleString("en")}</td><td>{money(usdOf(m[k]!, p))}</td></tr>
                    {/if}
                {/each}
            </tbody>
        </table>
        {#if s}
            <p class="big" role="status"><span>{money(s.total)}</span> <small>a season for this program</small></p>
            <p class="season">{dash.os.length} {dash.os.length === 1 ? "oracle" : "oracles"} reporting for a year ({money(s.reports)}), and enrolling and paying its {String(dash.p!.enrolled)} {dash.p!.enrolled === 1n ? "household" : "households"} ({money(s.delivery)}){s.share ? `: ${(s.share * 100).toPrecision(2)}% of the aid it pays` : ""}. At 1,000 households, {money(scale.total)} in all, {money(scale.perHousehold)} a household.</p>
        {/if}
        <p class="fine">Gas is the average of the latest real transactions of each kind. Mainnet price: Base's gas price now ({(Number(p.gasPrice) / 1e9).toPrecision(2)} gwei), plus the L1 data fee Base's GasPriceOracle quotes for the same transaction, with ETH at {money(p.ethUsd)} from Chainlink's ETH / USD feed on Base (updated {new Date(p.at * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC). Each oracle key reports {REPORTS_PER_KEY_PER_YEAR / 365} times a day. Gas prices move; the page re-prices on every visit.</p>
    {/if}
</article>

<style>
    .costs { width: 100%; border-collapse: collapse; font-size: 14px; margin: 6px 0 10px }
    .costs th, .costs td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line, #ddd); vertical-align: top }
    .costs td:not(:first-child), .costs th:not(:first-child) { text-align: right; white-space: nowrap }
    .costs small { display: block; opacity: 0.75 }
    .season { margin: 6px 0 10px }
</style>

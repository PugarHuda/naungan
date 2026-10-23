<script lang="ts">
    // Donor statement (donor?address=0x…): every gift and refund of one address, what each pool did with it, and
    // whether the chain agrees. Events come from a public RPC filtered on the donor; pool totals and each program's
    // contributed() are read from the contract itself, so the page never relies on our servers for a figure.
    import { onMount } from "svelte"
    import { getAddress, isAddress } from "ethers"
    import { deployment as d, isOver, naungan, parseMeta, type Program } from "../shared/chain"
    import { browserWallet, cancelled, why } from "../shared/wallet"
    import { netName, txUrl, usd } from "../dashboard/format"
    import { movesOf, statement, type Line, type Pool } from "./statement"
    import Hypercerts from "./Hypercerts.svelte"

    const c = naungan()
    let input = $state(new URLSearchParams(location.search).get("address") ?? "")
    let who = $state("")
    let lines = $state<Line[] | null>(null)
    let names = $state<Record<number, string>>({})
    let mismatch = $state<number[]>([])
    let source = $state("")
    let msg = $state("")
    let busy = $state(false)

    const total = (k: "gave" | "paid" | "refunded") => (lines ?? []).reduce((s, l) => s + l[k], 0n)
    const left = (state: Line["state"]) => (lines ?? []).filter((l) => l.state === state).reduce((s, l) => s + l.left, 0n)
    const households = $derived((lines ?? []).reduce((s, l) => s + l.households, 0))
    const date = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    const addrUrl = (a: string) => `${d.explorer}/address/${a}`

    async function load(ev?: SubmitEvent) {
        ev?.preventDefault()
        const a = input.trim()
        if (!isAddress(a)) return void (msg = "Enter a wallet address (0x followed by 40 hexadecimal characters).")
        who = getAddress(a)
        history.replaceState(null, "", `?address=${who}`)
        busy = true
        lines = null
        msg = "Reading this address's gifts from the chain…"
        try {
            const m = await movesOf(c, who)
            source = m.source
            const ids = [...new Set(m.gifts.map((g) => g.programId))]
            const now = Date.now() / 1000
            // One program at a time: the public RPC refuses more than 25 reads a second, and a donor may have funded many.
            const read: { id: number; p: Program; name: string; held: bigint }[] = []
            for (const id of ids) {
                const [p, meta, held]: [Program, string, bigint] = await Promise.all([c.programs(id), c.metadata(id), c.contributed(id, who)])
                read.push({ id, p, name: parseMeta(meta).name ?? `Program ${id}`, held })
            }
            const pools = new Map<number, Pool>(read.map(({ id, p }) => [id, { amountPerHousehold: p.amountPerHousehold, funded: p.funded, claims: p.claims, over: isOver(p, now) }]))
            const out = statement(m.gifts, m.refunds, pools)
            // The contract's own ledger of this donor: what is still theirs in each pool must equal the gifts found, or 0 once refunded.
            mismatch = out.filter((l) => read.find((r) => r.id === l.programId)!.held !== (l.refunded > 0n ? 0n : l.gave)).map((l) => l.programId)
            names = Object.fromEntries(read.map((r) => [r.id, r.name]))
            lines = out
            msg = out.length ? "" : `${who} has not funded any Naungan program on ${netName}.`
        } catch (e) {
            msg = `Could not read the statement: ${why(e)}`
        } finally {
            busy = false
        }
    }

    async function mine() {
        const eth = browserWallet()
        if (!eth) return void (msg = "No browser wallet found; paste the address you gave from instead.")
        try {
            const [a] = (await eth.request({ method: "eth_requestAccounts" })) as string[]
            input = a
            await load()
        } catch (e) {
            msg = cancelled(e) ? "Cancelled in the wallet." : `Could not read the wallet: ${why(e)}`
        }
    }

    onMount(() => void (input && load()))
</script>

<header class="top">
    <a class="brand" href="/">NAUNGAN</a>
    <nav><a href="/dashboard">Dashboard</a></nav>
</header>
<main>
    <h1>Donor statement</h1>
    <p class="lead">Every gift an address made to a Naungan program, how much of it reached households, and what is still in the pool or yours to take back. Read from the {netName} contract in your browser; no household is named or traceable.</p>

    <form class="ask" onsubmit={load}>
        <label for="addr">Donor address</label>
        <div class="row">
            <input id="addr" bind:value={input} placeholder="0x…" autocomplete="off" spellcheck="false" />
            <button class="btn" type="submit" disabled={busy}>Show statement</button>
            <button class="btn ghost" type="button" onclick={mine} disabled={busy}>Use my wallet</button>
        </div>
    </form>
    <p role="status" class="msg">{msg}</p>

    {#if lines?.length}
        <section aria-labelledby="sumH">
            <h2 id="sumH">Summary for <a class="mono" href={addrUrl(who)} target="_blank" rel="noopener">{who}</a></h2>
            <dl class="tiles">
                <div><dt>Given</dt><dd>{usd(total("gave"))} USDC</dd></div>
                <div><dt>Paid to households</dt><dd>{usd(total("paid"))} USDC</dd><dd class="sub">your share of {households.toLocaleString("en", { maximumFractionDigits: 2 })} household payouts</dd></div>
                <div><dt>Waiting in pools</dt><dd>{usd(left("pool"))} USDC</dd><dd class="sub">paid out if a trigger fires</dd></div>
                <div><dt>Yours to take back</dt><dd>{usd(left("refundable"))} USDC</dd>{#if total("refunded") > 0n}<dd class="sub">{usd(total("refunded"))} USDC already taken back</dd>{/if}</div>
            </dl>
            {#if mismatch.length}
                <p role="alert" class="warn">The contract's record of this address in program {mismatch.map((i) => `#${i}`).join(", ")} differs from the gifts found ({source}); the figures there may be incomplete.</p>
            {:else}
                <p class="ok">Checked: for every program, the contract's own record of this address (<code>contributed</code>) matches the gifts listed. Gifts found through {source}.</p>
            {/if}
        </section>

        <section aria-labelledby="progH">
            <h2 id="progH">By program</h2>
            <div class="scroll" role="region" aria-label="Statement by program" tabindex="-1">
                <table>
                    <thead><tr><th scope="col">Program</th><th scope="col">Given</th><th scope="col">To households</th><th scope="col">Left</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                        {#each lines as l (l.programId)}
                            <tr>
                                <td><a href="/dashboard?program={l.programId}">#{l.programId} {names[l.programId]}</a></td>
                                <td>{usd(l.gave)}</td>
                                <td>{usd(l.paid)}</td>
                                <td>{usd(l.left)}</td>
                                <td>{#if l.state === "pool"}In pool{:else if l.state === "refundable"}<a href="/dashboard?program={l.programId}">Refund open</a>{:else}Taken back ({usd(l.refunded)}){/if}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </section>

        <Hypercerts {who} programs={lines.map((l) => l.programId)} {names} />

        <section aria-labelledby="giftH">
            <div class="head"><h2 id="giftH">Gifts</h2><button class="btn ghost noprint" type="button" onclick={() => print()}>Print statement</button></div>
            <ol class="gifts">
                {#each lines.flatMap((l) => l.gifts) as g (g.tx + g.index)}
                    <li><span>{date(g.at)}</span><span>{usd(g.amount)} USDC to #{g.programId} {names[g.programId]}</span><a class="mono" href={txUrl(g.tx)} target="_blank" rel="noopener">{g.tx.slice(0, 10)}…{g.tx.slice(-6)}</a></li>
                {/each}
            </ol>
            <p class="fine">Each gift is a USDC transfer into contract <span class="mono">{d.naungan}</span> on {netName} (chain {d.chainId}), verifiable from its transaction. This statement is a record of transfers, not a tax receipt: where a gift is tax-deductible (for example Singapore's OHAS pilot), the designated charity that received it issues the receipt, and can attach this statement as proof of where the money went.</p>
        </section>
    {/if}
</main>

<style>
    :global(:root) { --bg: #f6f7f5; --fg: #14181a; --muted: #4a5358; --card: #fff; --line: #d9ddda; --accent: #0a6b36; --warn: #9a3412 }
    @media (prefers-color-scheme: dark) { :global(:root) { --bg: #101413; --fg: #e8ecea; --muted: #a9b3ae; --card: #182020; --line: #2c3533; --accent: #5fd08f; --warn: #fdba74 } }
    :global(body) { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
    .top { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; max-width: 960px; margin: 0 auto }
    .brand { font-weight: 800; letter-spacing: 0.08em; color: var(--fg); text-decoration: none }
    a { color: var(--accent) }
    main { max-width: 960px; margin: 0 auto; padding: 0 16px 48px }
    h1 { font-size: 30px; margin: 8px 0 6px }
    h2 { font-size: 19px; margin: 28px 0 10px; overflow-wrap: anywhere }
    .lead, .fine { color: var(--muted) }
    .fine { font-size: 14px }
    .ask label { display: block; font-weight: 600; margin: 18px 0 6px }
    .row { display: flex; flex-wrap: wrap; gap: 8px }
    .row input { flex: 1 1 260px; min-width: 0; font: 15px ui-monospace, monospace; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--fg) }
    .btn { font: 600 15px system-ui, sans-serif; padding: 10px 16px; border-radius: 10px; border: 0; background: var(--accent); color: var(--bg); cursor: pointer }
    .btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent) }
    .btn:disabled { opacity: 0.6; cursor: progress }
    .msg { min-height: 1.5em; color: var(--muted) }
    .mono { font-family: ui-monospace, monospace; overflow-wrap: anywhere }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 0 }
    .tiles div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px }
    dt { color: var(--muted); font-size: 14px }
    dd { margin: 2px 0 0; font-size: 22px; font-weight: 700 }
    dd.sub { font-size: 13px; font-weight: 400; color: var(--muted) }
    .ok { color: var(--accent) }
    .warn { color: var(--warn); font-weight: 600 }
    .scroll { overflow-x: auto }
    @media (max-width: 520px) { table { font-size: 14px } }
    table { border-collapse: collapse; width: 100%; background: var(--card); font-size: 15px }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top }
    th { color: var(--muted); font-weight: 600 }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap }
    .head h2 { margin-bottom: 0 }
    .gifts { list-style: none; padding: 0; margin: 12px 0 0 }
    .gifts li { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 8px 0; border-bottom: 1px solid var(--line) }
    .gifts li span:first-child { min-width: 100px; color: var(--muted) }
    .gifts li span:nth-child(2) { flex: 1 1 240px }
    @media print { .ask, .msg, .top nav, .noprint { display: none } :global(body) { background: #fff; color: #000 } .tiles div, table { border-color: #999 } }
</style>

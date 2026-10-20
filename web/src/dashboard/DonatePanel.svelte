<script lang="ts">
    import { Contract, parseUnits } from "ethers"
    import { deployment as d, ERC20_ABI, isOver, type Program } from "../shared/chain"
    import { c, dash } from "./state.svelte"
    import { netName, short, txUrl, usd, type Part } from "./format"
    import { browserWallet, cancelled, sendBatch, walletSigner, why } from "../shared/wallet"
    import Message from "./Message.svelte"

    let amount = $state<number | null>(1) // bind:value on a number input yields a number (null when empty)
    let busy = $state(false)
    let msg = $state<Part[]>([])
    // The contract takes no money once claims are over; each donor then pulls back their own share of what was not paid out.
    const over = $derived(!!dash.p && isOver(dash.p, dash.now))
    const say = (text: string, href?: string, label = "View transaction") => (msg = href ? [text, " ", { href, label }] : [text])

    async function submit(ev: SubmitEvent) {
        ev.preventDefault()
        const eth = browserWallet()
        if (!eth) return say("No browser wallet found. Install one (e.g. MetaMask or Coinbase Wallet), or fund with scripts/coordinator.js.")
        const pid = dash.pid
        if (pid === undefined) return
        busy = true
        try {
            const p: Program = await c.programs(pid)
            if (isOver(p)) return await refund(p, pid, eth)
            const amt = parseUnits(String(amount ?? 0), 6)
            if (amt <= 0n) throw new Error("enter an amount above 0")
            say("Waiting for your wallet…")
            const signer = await walletSigner(eth)
            const me = await signer.getAddress()
            const usdc = new Contract(await c.token(), ERC20_ABI, signer)
            const bal: bigint = await usdc.balanceOf(me)
            if (bal < amt) return void (msg = [`${short(me)} has ${usd(bal)} USDC. Get free testnet USDC at `, { href: "https://faucet.circle.com", label: "faucet.circle.com" }, " (Base Sepolia), then try again."])
            const done = (h: string) => say(`Thank you: ${usd(amt)} USDC is in program #${pid}'s pool. It appears in the ledger as soon as the block is indexed.`, txUrl(h))
            if ((await usdc.allowance(me, d.naungan)) < amt) {
                // Smart wallets (EIP-5792) take approve + fund as one atomic batch: one confirmation, and no allowance left behind.
                say("Confirm in your wallet…")
                const batched = await sendBatch(eth, me, [
                    { to: usdc.target as string, data: usdc.interface.encodeFunctionData("approve", [d.naungan, amt]) },
                    { to: d.naungan, data: c.interface.encodeFunctionData("fund", [pid, amt]) }
                ])
                if (batched) return done(batched)
                say("Step 1 of 2: approve the program contract to take exactly this amount…")
                await (await usdc.approve(d.naungan, amt)).wait()
            }
            say("Step 2 of 2: confirm the funding transaction…")
            // Our own read RPC can lag the wallet's: give fund() an explicit gas limit so estimation never sees a stale allowance.
            const tx = await (c.connect(signer) as Contract).fund(pid, amt, { gasLimit: 150000n })
            say("Funding sent, waiting for the block…", txUrl(tx.hash))
            const r = await tx.wait()
            if (r.status !== 1) throw new Error("the funding transaction reverted")
            done(tx.hash)
        } catch (e) {
            say(cancelled(e) ? "Cancelled in the wallet." : `Could not fund: ${why(e)}`)
        } finally {
            busy = false
        }
    }

    async function refund(p: Program, pid: bigint, eth: NonNullable<ReturnType<typeof browserWallet>>) {
        say("Waiting for your wallet…")
        const signer = await walletSigner(eth)
        const me = await signer.getAddress()
        const gave: bigint = await c.contributed(pid, me)
        if (gave === 0n) return say(`${short(me)} has no money in program #${pid} to take back (or already took it).`)
        const share = (gave * (p.funded - p.claims * p.amountPerHousehold)) / p.funded
        say(`You gave ${usd(gave)} USDC; your share of what was not paid out is ${usd(share)} USDC. Confirm in your wallet…`)
        const tx = await (c.connect(signer) as Contract).refund(pid, { gasLimit: 120000n })
        say("Refund sent, waiting for the block…", txUrl(tx.hash))
        if ((await tx.wait()).status !== 1) throw new Error("the refund transaction reverted")
        say(`${usd(share)} USDC is back in ${short(me)}.`, txUrl(tx.hash))
    }
</script>

<form class="give donate" onsubmit={submit}>
    <h2>{over ? "Take back your share" : "Add to the pool"}</h2>
    <p class="lead-in" style="margin:0">From any browser wallet on {netName}.{d.usdcIsCircle ? " Test USDC is free at faucet.circle.com." : ""}</p>
    <label class="amount" for="donateAmt" hidden={over}>
        <input id="donateAmt" type="number" inputmode="decimal" min="0.01" step="0.01" required={!over} aria-label="Amount in USDC" bind:value={amount} /><span>USDC</span>
    </label>
    <button class="btn go" type="submit" disabled={busy}>{over ? "Connect wallet and refund" : "Connect wallet and fund"}</button>
    <div id="donateMsg" role="status"><Message parts={msg} /></div>
</form>

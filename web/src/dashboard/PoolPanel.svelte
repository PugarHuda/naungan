<script lang="ts">
    import { dash } from "./state.svelte"
    import { usd } from "./format"

    // Money: paid out, still owed to the enrolled households who have not claimed, and what is left over.
    const m = $derived.by(() => {
        const p = dash.p
        if (!p) return null
        const amt = p.amountPerHousehold, disbursed = p.claims * amt
        const owed = (p.enrolled - p.claims) * amt, left = p.funded - disbursed
        const held = owed < left ? owed : left
        const pct = (v: bigint) => (p.funded > 0n ? Number((v * 10000n) / p.funded) / 100 : 0) + "%"
        return { amt, funded: p.funded, disbursed, held, spare: p.funded - disbursed - owed, paidW: pct(disbursed), heldW: pct(held) }
    })
</script>

<div>
    <h2>The pool</h2>
    <p class="lead-in">USDC held by the contract for this program only.</p>
    <div class="big"><span>{m ? usd(m.funded) : "–"}</span> <small>USDC funded</small></div>
    <div class="pool" aria-hidden="true"><i class="paid" style:width={m?.paidW ?? "0%"}></i><i class="held" style:width={m?.heldW ?? "0%"}></i></div>
    <div class="keys">
        <span class="k-paid">Paid out <b>{m ? usd(m.disbursed) : "–"}</b> USDC</span>
        <span class="k-held">Reserved for enrolled households <b>{m ? usd(m.held) : "–"}</b> USDC</span>
        <span class="k-free">
            {#if m}
                {m.spare >= 0n ? "Unallocated " : "Short by "}<b>{usd(m.spare >= 0n ? m.spare : -m.spare)}</b>{` USDC${m.spare < 0n ? ` to pay every enrolled household ${usd(m.amt)} USDC` : m.spare >= m.amt ? `, enough for ${m.spare / m.amt} more households` : ", every enrolled household is covered"}`}
            {:else}–{/if}
        </span>
    </div>
</div>

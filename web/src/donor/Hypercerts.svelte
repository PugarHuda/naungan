<script lang="ts">
    // Impact certificates (scripts/hypercert.js): each program's payouts as a hypercert, whose fractions belong to the
    // donors who paid for them. The allowlist comes from this site, but nothing is taken on trust: its sha256 must match
    // web/hypercerts.json, and HypercertMinter itself confirms (isAllowedToClaim) that the proof fits the root it stored.
    import { Contract } from "ethers"
    import { deployment as d, provider } from "../shared/chain"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import { txUrl } from "../dashboard/format"
    import { ABI, APP, proofOf } from "../../../lib/hypercert.mjs"
    import minted from "../../hypercerts.json"

    type Entry = (typeof minted)[number]
    type Row = { x: Entry; units: bigint; proof: string[]; held: boolean; tx?: string }
    let { who, programs, names }: { who: string; programs: number[]; names: Record<number, string> } = $props()

    const mine = minted.filter((x) => x.claimID && x.chainId === d.chainId && x.contract.toLowerCase() === d.naungan.toLowerCase() && programs.includes(x.programId))
    let rows = $state<Row[]>([])
    let msg = $state("")
    let busy = $state("")

    const appUrl = (x: Entry) => `${APP[d.chainId as keyof typeof APP]}/hypercerts/${d.chainId}-${x.minter}-${x.claimID}`
    const pct = (u: bigint, of: string) => `${((Number(u) / Number(of)) * 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`
    const usdcOf = (u: bigint, x: Entry) => (Number((BigInt(x.paid) * u) / BigInt(x.units)) / 1e6).toLocaleString("en", { maximumFractionDigits: 2 })
    const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("")

    async function check() {
        const minter = new Contract(mine[0].minter, ABI, provider())
        const out: Row[] = []
        for (const x of mine) {
            // Same origin as this page (also on previews): the file the indexer reads at x.uri is the same deployment's.
            const text = await (await fetch(new URL(x.uri).pathname.replace(/\.json$/, "-allowlist.json"))).text()
            if ((await hex(text)) !== x.allowListSha256) throw new Error(`the allowlist of program #${x.programId} differs from the one minted`)
            const p = proofOf(text, who)
            if (!p) continue
            const [ok, held] = await Promise.all([minter.isAllowedToClaim(p.proof, x.claimID, p.leaf), minter.hasBeenClaimed(x.claimID, p.leaf)])
            if (!ok) throw new Error(`HypercertMinter does not accept this address's proof for program #${x.programId}`)
            out.push({ x, units: p.units, proof: p.proof, held })
        }
        rows = out
    }

    async function claim(r: Row) {
        const eth = browserWallet()
        if (!eth) return void (msg = "Open this page in a browser with a wallet (MetaMask, Coinbase Wallet, Rabby) to add the fraction.")
        busy = r.x.claimID!
        msg = ""
        try {
            const signer = await walletSigner(eth)
            if ((await signer.getAddress()).toLowerCase() !== who.toLowerCase()) throw new Error(`connect ${who}, the address that gave; the fraction can only go to it`)
            const tx = await new Contract(r.x.minter, ABI, signer).mintClaimFromAllowlist(who, r.proof, r.x.claimID, r.units)
            msg = "Sent; waiting for the block…"
            await tx.wait()
            rows = rows.map((y) => (y === r ? { ...y, held: true, tx: tx.hash } : y))
            msg = "The fraction is in your wallet."
        } catch (e) {
            msg = cancelled(e) ? "Cancelled in the wallet." : `Could not add it: ${why(e)}`
        } finally {
            busy = ""
        }
    }

    $effect(() => {
        if (mine.length) check().catch((e) => (msg = `Could not check the impact certificates: ${why(e)}`))
    })
</script>

{#if mine.length}
    <section aria-labelledby="hcH">
        <h2 id="hcH">Impact certificates</h2>
        <p class="fine">Each program's payouts are a <a href="https://hypercerts.org" target="_blank" rel="noopener">hypercert</a>: an on-chain claim to that impact, split among the donors who paid for it, pro rata to their gifts. Your fraction is yours to keep, give or sell to a retroactive funder; nobody else can mint it.</p>
        {#each rows as r (r.x.claimID)}
            <div class="hc">
                <div>
                    <strong>#{r.x.programId} {names[r.x.programId]}</strong>
                    <span>{r.x.claims} households paid · your fraction {pct(r.units, r.x.units)} ({usdcOf(r.units, r.x)} USDC of the payouts)</span>
                    <span class="fine">Checked: allowlist hash matches, and HypercertMinter accepts this address's proof. <a href={appUrl(r.x)} target="_blank" rel="noopener">View on Hypercerts</a> · <a href={txUrl(r.x.tx!)} target="_blank" rel="noopener">minted</a></span>
                </div>
                {#if r.held}
                    <span class="ok">{#if r.tx}<a href={txUrl(r.tx)} target="_blank" rel="noopener">In your wallet</a>{:else}In your wallet{/if}</span>
                {:else}
                    <button class="btn noprint" type="button" disabled={!!busy} onclick={() => claim(r)}>{busy === r.x.claimID ? "Adding…" : "Add to my wallet"}</button>
                {/if}
            </div>
        {/each}
        <p role="status" class="msg">{msg}</p>
    </section>
{/if}

<style>
    .hc { display: flex; flex-wrap: wrap; gap: 10px 16px; justify-content: space-between; align-items: center; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 8px 0 }
    .hc div { display: flex; flex-direction: column; gap: 2px; flex: 1 1 280px; min-width: 0 }
    .fine { color: var(--muted); font-size: 14px }
    .msg { min-height: 1.5em; color: var(--muted) }
    .ok { color: var(--accent); font-weight: 600 }
    .btn { font: 600 15px system-ui, sans-serif; padding: 10px 16px; border-radius: 10px; border: 0; background: var(--accent); color: var(--bg); cursor: pointer }
    .btn:disabled { opacity: 0.6; cursor: progress }
    @media print { .noprint { display: none } }
</style>

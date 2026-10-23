<script lang="ts">
    // Impact certificates (scripts/hypercert.js): each program's payouts as a hypercert, whose fractions belong to the
    // donors who paid for them. Metadata and allowlist come from this site, but nothing is taken on trust: their sha256
    // must match web/hypercerts.json, the URI must be the one HypercertMinter stored, and the minter itself confirms
    // (isAllowedToClaim) that the proof fits the root it stored.
    import { Contract } from "ethers"
    import { deployment as d, provider } from "../shared/chain"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import { txUrl } from "../dashboard/format"
    import { ABI, proofOf } from "../../../lib/hypercert.mjs"
    import minted from "../../hypercerts.json"

    type Entry = (typeof minted)[number]
    type Row = { x: Entry; units: bigint; proof: string[]; held: boolean; image: string; tx?: string }
    let { who, programs, names }: { who: string; programs: number[]; names: Record<number, string> } = $props()

    const mine = minted.filter((x) => x.claimID && x.chainId === d.chainId && x.contract.toLowerCase() === d.naungan.toLowerCase() && programs.includes(x.programId))
    let rows = $state<Row[]>([])
    let msg = $state("")
    let busy = $state("")

    const pct = (u: bigint, of: string) => `${((Number(u) / Number(of)) * 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`
    const usdcOf = (u: bigint, x: Entry) => (Number((BigInt(x.paid) * u) / BigInt(x.units)) / 1e6).toLocaleString("en", { maximumFractionDigits: 2 })
    const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("")

    async function check() {
        const minter = new Contract(mine[0].minter, ABI, provider())
        const out: Row[] = []
        for (const x of mine) {
            // Read from this page's own origin (also on previews): the deployment that serves x.uri serves the same files.
            const path = new URL(x.uri).pathname
            const [meta, list] = await Promise.all([path, path.replace(/\.json$/, "-allowlist.json")].map(async (u) => (await fetch(u)).text()))
            if ((await hex(meta)) !== x.sha256 || (await hex(list)) !== x.allowListSha256) throw new Error(`the files of program #${x.programId}'s hypercert differ from the ones minted`)
            const p = proofOf(list, who)
            if (!p) continue
            const [uri, ok, held] = await Promise.all([minter.uri(x.claimID), minter.isAllowedToClaim(p.proof, x.claimID, p.leaf), minter.hasBeenClaimed(x.claimID, p.leaf)])
            if (uri !== x.uri || !ok) throw new Error(`HypercertMinter does not hold this hypercert as recorded for program #${x.programId}`)
            out.push({ x, units: p.units, proof: p.proof, held, image: JSON.parse(meta).image })
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
                <img src={r.image} alt="Impact certificate card: {r.x.claims} households paid by program #{r.x.programId}" width="96" height="120" />
                <div>
                    <strong>#{r.x.programId} {names[r.x.programId]}</strong>
                    <span>{r.x.claims} households paid · your fraction {pct(r.units, r.x.units)} ({usdcOf(r.units, r.x)} USDC of the payouts)</span>
                    <span class="fine">Checked: the files match the hashes minted, and Hypercerts' HypercertMinter holds this URI and accepts this address's proof. <a href={r.x.uri} target="_blank" rel="noopener">Metadata</a> · <a href={txUrl(r.x.tx!)} target="_blank" rel="noopener">Minted on {d.network === "baseSepolia" ? "Base Sepolia" : d.network}</a></span>
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
    a { color: var(--accent) }
    .hc img { border-radius: 8px; flex: none }
    .hc div { display: flex; flex-direction: column; gap: 2px; flex: 1 1 280px; min-width: 0 }
    .fine { color: var(--muted); font-size: 14px }
    .msg { min-height: 1.5em; color: var(--muted) }
    .ok { color: var(--accent); font-weight: 600 }
    .btn { font: 600 15px system-ui, sans-serif; padding: 10px 16px; border-radius: 10px; border: 0; background: var(--accent); color: var(--bg); cursor: pointer }
    .btn:disabled { opacity: 0.6; cursor: progress }
    @media print { .noprint { display: none } }
</style>

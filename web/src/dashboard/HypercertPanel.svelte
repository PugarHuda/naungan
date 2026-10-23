<script lang="ts">
    // The program's impact certificate (scripts/hypercert.js) and anyone's check of it: this browser re-verifies every
    // payout's zero-knowledge proof, recomputes the donors' allowlist from the Funded events and re-hashes the files
    // (lib/hypercert.mjs evaluate), then the visitor can sign the result under Hypercerts' own evaluation schema on EAS,
    // which Hypercerts' app reads to mark a hypercert verified or disputed. Evaluations already signed are listed.
    import { deployment as d } from "../shared/chain"
    import { c, dash } from "./state.svelte"
    import { short, txUrl, usd, type Part } from "./format"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import Message from "./Message.svelte"
    import minted from "../../hypercerts.json"

    type Entry = (typeof minted)[number]
    type Verdict = { basic: number; work: number; contributors: number; properties: number; why: string[] }
    type Evaluation = { uid: string; attester: string; time: number; verified: boolean; disputed: boolean }
    const FIELDS: [keyof Omit<Verdict, "why">, string][] = [["basic", "States the households and USDC paid"], ["work", "Every payout's proof verifies"], ["contributors", "Fractions are the donors' shares"], ["properties", "Files are the ones minted"]]

    const entry = $derived(minted.find((x) => x.claimID && x.chainId === d.chainId && x.contract.toLowerCase() === d.naungan.toLowerCase() && BigInt(x.programId) === dash.pid))
    let image = $state("")
    let busy = $state(false)
    let note = $state("")
    let verdict = $state<Verdict | null>(null)
    let sign = $state<{ cls: string; parts: Part[] } | null>(null)
    let evals = $state<Evaluation[] | null>(null)
    let evalNote = $state("")
    let rev = $state(0)

    // The card from the metadata, shown only when the file is the one hashed at mint.
    $effect(() => {
        const x = entry
        image = ""
        verdict = null
        sign = null
        note = ""
        if (!x) return
        let live = true
        Promise.all([fetch(new URL(x.uri).pathname).then((r) => r.text()), import("../../../lib/hypercert.mjs")])
            .then(async ([text, hc]) => {
                if (live && (await hc.sha256(text)) === x.sha256) image = JSON.parse(text).image
            })
            .catch(() => {})
        return () => (live = false)
    })

    $effect(() => {
        const x = entry
        void rev
        evals = null
        evalNote = ""
        if (!x || !d.eas) return
        const graphql = d.eas.graphql
        let live = true
        import("../../../lib/hypercert.mjs")
            .then(async (hc) => {
                const list = hc.latestPerAttester(await hc.listEvaluations({ graphql, entry: x })) as Evaluation[]
                if (live) evals = list
            })
            .catch((e) => live && (evalNote = `Evaluations on EAS are unavailable right now (${e.message}).`))
        return () => (live = false)
    })

    async function check(x: Entry) {
        const id = dash.pid!
        const events = dash.current ?? []
        const claimed = events.filter((e) => e.fragment.name === "Claimed" && e.args.programId === id)
        busy = true
        verdict = null
        sign = null
        note = `Verifying ${claimed.length} payouts and recomputing the allowlist…`
        try {
            const total = Number((await c.programs(id)).claims)
            if (claimed.length < total) return void (note = `The ledger is still loading (${claimed.length} of ${total} payouts found). Try again in a few seconds.`)
            const provider = c.runner!.provider!
            const path = new URL(x.uri).pathname
            const [{ auditClaims }, hc, members, claims, metaText, listText] = await Promise.all([
                import("../shared/audit.mjs"),
                import("../../../lib/hypercert.mjs"),
                c.members(id) as Promise<bigint[]>,
                Promise.all(claimed.map(async (e) => ({ nullifier: e.args.nullifier, payout: e.args.payout, tx: (await provider.getTransaction(e.transactionHash)) ?? { hash: e.transactionHash, to: null, data: "0x" } }))),
                fetch(path).then((r) => r.text()),
                fetch(path.replace(/\.json$/, "-allowlist.json")).then((r) => r.text())
            ])
            const res: { ok: boolean }[] = await auditClaims({ programId: id, members: members.map(String), claims, contract: d.naungan })
            const gifts = events.filter((e) => e.fragment.name === "Funded" && e.args.programId === id).map((e) => ({ donor: e.args.donor as string, amount: e.args.amount as bigint, block: e.blockNumber }))
            if (id !== dash.pid) return
            verdict = (await hc.evaluate({ entry: x, metaText, listText, gifts, payouts: res.map((r, i) => ({ block: claimed[i].blockNumber, ok: r.ok })) })) as Verdict
            note = ""
        } catch (e) {
            if (id === dash.pid) note = `Could not check the certificate (${why(e)}). Try again in a minute.`
        } finally {
            busy = false
        }
    }

    async function attest(x: Entry, v: Verdict) {
        const eas = d.eas!
        const say = (cls: string, text: string, href?: string, label = "View transaction") => (sign = { cls, parts: href ? [text, " ", { href, label }] : [text] })
        const eth = browserWallet()
        if (!eth) return say("verdict", `No browser wallet found. Evaluators without one can run \`node scripts/eas.js hypercert --program ${x.programId}\` with their own key.`)
        try {
            const [hc, eas_] = await Promise.all([import("../../../lib/hypercert.mjs"), import("../shared/audit.mjs")])
            say("verdict", "Confirm the evaluation in your wallet…")
            const signer = await walletSigner(eth)
            const tx = await signer.sendTransaction({ to: eas.address, data: hc.evaluationCall(x, v, hc.evaluationComment(x, v, "")) })
            say("verdict", "Sent, waiting for the block…", txUrl(tx.hash))
            const uid = eas_.attestedUid(await tx.wait())
            say("verdict ok", `Signed by ${short(await signer.getAddress())} under Hypercerts' evaluation schema.`, `${eas.explorer}/attestation/view/${uid}`, "View on EAS")
            setTimeout(() => rev++, 8000) // the EAS indexer needs a few seconds to pick it up
        } catch (e) {
            say("verdict bad", cancelled(e) ? "Cancelled in the wallet." : `Could not sign: ${why(e)}`)
        }
    }

    // One evaluation per address (its newest). Evaluators are self-declared, as on Hypercerts' app: the count says how
    // many addresses signed, not who they are. The minting key checking its own certificate is shown, never counted.
    const own = (e: Evaluation) => !!entry?.creator && e.attester.toLowerCase() === entry.creator.toLowerCase()
    const verified = $derived(evals?.filter((e) => e.verified && !own(e)).length ?? 0)
    const disputed = $derived(evals?.filter((e) => e.disputed && !own(e)).length ?? 0)
</script>

{#if entry}
    <article class="panel" aria-labelledby="hcH">
        <h2 id="hcH">Impact certificate</h2>
        <div class="hcard">
            {#if image}<img src={image} alt="Impact certificate card: {entry.claims} households paid by program #{entry.programId}" width="120" height="150" />{/if}
            <p class="lead-in">
                These {entry.claims} payouts ({usd(BigInt(entry.paid))} USDC, up to block {entry.block}) are a <a href="https://hypercerts.org" target="_blank" rel="noopener">hypercert</a> on Hypercerts' own contract, its fractions owned by the donors who paid for them. Retroactive funders read it; your check makes it worth something.
                <a href={txUrl(entry.tx!)} target="_blank" rel="noopener">Minted</a> · <a href={entry.uri} target="_blank" rel="noopener">Metadata</a>
            </p>
        </div>
        <button class="btn dark" type="button" disabled={busy} onclick={() => check(entry)}>Check this certificate</button>
        <div class="result" role="status">
            {#if note}<div class="verdict">{note}</div>{/if}
            {#if verdict}
                <ul class="checks hcv">
                    {#each FIELDS as [k, label] (k)}<li class:bad={verdict[k] !== 1}>{verdict[k] === 1 ? "✓" : "✗"} {label}</li>{/each}
                </ul>
                {#each verdict.why as w (w)}<div class="verdict bad">{w}</div>{/each}
                {#if d.eas}
                    {#if sign}
                        <div class={sign.cls}><Message parts={sign.parts} /></div>
                    {:else}
                        <button class="recheck" type="button" onclick={() => verdict && attest(entry, verdict)}>Sign this as a Hypercerts evaluation (EAS)</button>
                    {/if}
                {/if}
            {/if}
        </div>
        {#if d.eas}
            <div class="result" role="status">
                {#if evals}
                    <div class="head verdict {disputed ? 'bad' : verified ? 'ok' : ''}">
                        <b>{evals.length}</b>
                        <span>{evals.length ? `${evals.length === 1 ? "address has" : "addresses have"} signed a Hypercerts evaluation on EAS: ${verified} other than Naungan found it valid${disputed ? `, ${disputed} disputed it` : ""}${evals.some(own) ? " (Naungan's own check not counted)" : ""}. Evaluators are self-declared: open each to see who signed.` : "addresses have signed a Hypercerts evaluation yet. Check the certificate above and be the first."}</span>
                    </div>
                    <ol>
                        {#each evals as e (e.uid)}
                            <li class:bad={!e.verified}><a href="{d.eas.explorer}/attestation/view/{e.uid}" target="_blank" rel="noopener">{e.verified ? "✓" : "✗"} {short(e.attester)}</a>{own(e) ? ", Naungan's own key" : ""}</li>
                        {/each}
                    </ol>
                {:else if evalNote}
                    <div class="verdict">{evalNote}</div>
                {/if}
            </div>
        {/if}
    </article>
{/if}

<style>
    .hcard { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap }
    .hcard img { border-radius: 10px; flex: none }
    .hcard p { flex: 1 1 220px; margin-top: 0 }
    .hcv li.bad { color: var(--warn) }
</style>

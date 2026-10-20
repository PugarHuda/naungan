<script lang="ts">
    // Payout audit: each Claimed event's transaction is fetched and its Groth16 proof verified in this browser
    // (snarkjs + Semaphore's verification keys, lib/audit.mjs), against the group rebuilt from members().
    // The result can be signed on EAS (lib/eas.mjs); everyone else's published runs are listed below.
    import { deployment as d } from "../shared/chain"
    import { c, dash } from "./state.svelte"
    import { short, txUrl, type Part } from "./format"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import Message from "./Message.svelte"

    type Row = { ok: boolean; hash: string; failed: string[] }
    type Done = { pid: bigint; good: number; rows: Row[]; members: string[]; atBlock: number }
    type Listed = { auditors: number; clean: number; flagged: number; latest: { uid: string; attester: string; verified: number; claims: number; atBlock: number }[] }

    const NAMES: Record<string, string> = { direct: "direct claim() call", scope: "this program", payout: "paid to the proof’s address", nullifier: "event matches proof", root: "enrolled group", proof: "Groth16 proof valid", unique: "nullifier used once" }

    let busy = $state(false)
    let note = $state<{ cls: string; text: string } | null>(null)
    let done = $state<Done | null>(null)
    let sign = $state<{ cls: string; parts: Part[] } | null>(null)
    let listed = $state<Listed | null>(null)
    let listNote = $state("")

    // A new program starts with a clean slate.
    $effect(() => {
        void dash.pid
        note = null
        done = null
        sign = null
    })

    $effect(() => {
        const id = dash.pid
        void dash.auditorsRev
        if (id === undefined || !d.eas) return
        const eas = d.eas
        let live = true
        listed = null
        listNote = ""
        import("../shared/audit.mjs")
            .then(async ({ listAudits, summarise }) => {
                const s = summarise(await listAudits({ graphql: eas.graphql, naungan: d.naungan, programId: id })) as Listed
                if (live) listed = { ...s, latest: [...s.latest].sort((p, q) => q.atBlock - p.atBlock) }
            })
            .catch((e) => live && (listNote = `Independent audits on EAS are unavailable right now (${e.message}).`))
        return () => (live = false)
    })

    async function audit() {
        const id = dash.pid
        if (id === undefined) return (note = { cls: "verdict", text: "Still connecting to the chain. Try again in a few seconds." })
        const claimed = (dash.current ?? []).filter((e) => e.fragment.name === "Claimed" && e.args.programId === id)
        busy = true
        done = null
        sign = null
        note = { cls: "verdict", text: `Fetching ${claimed.length} transactions and verifying their proofs…` }
        try {
            // The contract's own counter says how many Claimed events the ledger must hold for a complete audit.
            const total = Number((await c.programs(id)).claims)
            if (id !== dash.pid) return
            if (!total) return (note = { cls: "verdict", text: "No payouts in this program yet: nothing to verify." })
            if (claimed.length < total) return (note = { cls: "verdict", text: `The ledger is still loading (${claimed.length} of ${total} payouts found). Try again in a few seconds.` })
            const provider = c.runner!.provider!
            const [{ auditClaims }, members, claims] = await Promise.all([
                import("../shared/audit.mjs"),
                c.members(id) as Promise<bigint[]>,
                Promise.all(claimed.map(async (e) => ({ nullifier: e.args.nullifier, payout: e.args.payout, tx: (await provider.getTransaction(e.transactionHash)) ?? { hash: e.transactionHash, to: null, data: "0x" } })))
            ])
            const atBlock = await provider.getBlockNumber()
            const res: { hash: string; ok: boolean; checks: Record<string, boolean | null> }[] = await auditClaims({ programId: id, members: members.map(String), claims, contract: d.naungan })
            if (id !== dash.pid) return
            note = null
            done = {
                pid: id,
                good: res.filter((r) => r.ok).length,
                rows: res.map((r) => ({ ok: r.ok, hash: r.hash, failed: Object.entries(r.checks).filter(([, v]) => v !== true).map(([k]) => NAMES[k]) })),
                members: members.map(String),
                atBlock
            }
        } catch (e) {
            if (id === dash.pid) note = { cls: "verdict bad", text: `Could not run the audit (${(e as Error).message}). Try again in a minute.` }
        } finally {
            busy = false
        }
    }

    async function attest(a: Done) {
        const eas = d.eas!
        const say = (cls: string, text: string, href?: string, label = "View transaction") => (sign = { cls, parts: href ? [text, " ", { href, label }] : [text] })
        const eth = browserWallet()
        if (!eth) return say("verdict", `No browser wallet found. Auditors without one can run \`node scripts/eas.js audit --program ${a.pid}\` with their own key.`)
        try {
            const { attestCall, attestedUid, groupRoot } = await import("../shared/audit.mjs")
            say("verdict", "Confirm the attestation in your wallet…")
            const signer = await walletSigner(eth)
            const tx = await signer.sendTransaction({ to: eas.address, data: attestCall(d.naungan, { programId: a.pid, claims: a.rows.length, verified: a.good, members: a.members.length, groupRoot: groupRoot(a.members) ?? 0n, atBlock: a.atBlock }) })
            say("verdict", "Sent, waiting for the block…", txUrl(tx.hash))
            const uid = attestedUid(await tx.wait())
            say("verdict ok", `Signed by ${short(await signer.getAddress())}: ${a.good} of ${a.rows.length} payouts verified at block ${a.atBlock}.`, `${eas.explorer}/attestation/view/${uid}`, "View on EAS")
            setTimeout(() => dash.auditorsRev++, 8000) // the EAS indexer needs a few seconds to pick it up
        } catch (e) {
            say("verdict bad", cancelled(e) ? "Cancelled in the wallet." : `Could not attest: ${why(e)}`)
        }
    }
</script>

<article class="panel" aria-labelledby="auditH">
    <h2 id="auditH">Check every payout yourself</h2>
    <p class="lead-in">Your browser fetches each claim transaction and verifies its zero-knowledge proof again, without trusting the contract or this page. Nobody learns which household claimed.</p>
    <button class="btn dark" type="button" disabled={busy} onclick={audit}>Verify every payout</button>
    <ul class="checks">
        <li>Proof is mathematically valid</li><li>Prover is in the enrolled group</li>
        <li>Proof is for this program</li><li>Paid to the address in the proof</li>
        <li>Each household claimed once</li><li>Event matches the transaction</li>
    </ul>
    <div class="result" role="status">
        {#if note}<div class={note.cls}>{note.text}</div>{/if}
        {#if done}
            <div class="head verdict {done.good === done.rows.length ? 'ok' : 'bad'}">
                <b>{done.good} of {done.rows.length}</b><span>payouts verified against a group of {done.members.length} households rebuilt from the contract</span>
            </div>
            <ol>
                {#each done.rows as r (r.hash)}
                    <li class:bad={!r.ok}>
                        {#if txUrl(r.hash)}<a href={txUrl(r.hash)} target="_blank" rel="noopener">{r.ok ? "✓" : "✗"} {short(r.hash)}</a>{:else}<span>{r.ok ? "✓" : "✗"} {short(r.hash)}</span>{/if}{r.ok ? "" : `, failed: ${r.failed.join(", ")}`}
                    </li>
                {/each}
            </ol>
            {#if d.eas}
                <p class="fine">Publish what you just found under your own address, so donors can count independent checks instead of trusting us.</p>
                {#if sign}
                    <div class={sign.cls}><Message parts={sign.parts} /></div>
                {:else}
                    <button class="recheck" type="button" onclick={() => done && attest(done)}>Sign this result on-chain (EAS)</button>
                {/if}
            {/if}
        {/if}
    </div>
    {#if d.eas}
        <div class="result" role="status">
            {#if listed}
                <div class="head verdict {listed.flagged ? 'bad' : listed.auditors ? 'ok' : ''}">
                    <b>{listed.auditors}</b>
                    <span>
                        {listed.auditors
                            ? `independent ${listed.auditors === 1 ? "auditor has" : "auditors have"} signed this check on EAS: ${listed.clean} found every payout valid${listed.flagged ? `, ${listed.flagged} flagged a payout` : ""}`
                            : "independent audits signed on EAS yet. Run the check above and be the first."}
                    </span>
                </div>
                <ol>
                    {#each listed.latest as x (x.uid)}
                        <li class:bad={x.verified !== x.claims}>
                            <a href="{d.eas.explorer}/attestation/view/{x.uid}" target="_blank" rel="noopener">{x.verified === x.claims ? "✓" : "✗"} {short(x.attester)}</a>, {x.verified} of {x.claims} at block {x.atBlock}
                        </li>
                    {/each}
                </ol>
            {:else if listNote}
                <div class="verdict">{listNote}</div>
            {/if}
        </div>
    {/if}
</article>

<script lang="ts">
    // Steps 4 and 5: the terms, the exact metadata, and createProgram() from the coordinator's own wallet.
    import { Contract, getAddress, isAddress, parseUnits } from "ethers"
    import QRCode from "qrcode"
    import { deployment as d, ERC20_ABI } from "../shared/chain"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import { draft, metaOf, oracleList, setSecond, HOSTED_ORACLE } from "./draft.svelte"
    import { PAIRS } from "../../../lib/hazard.mjs"
    const SOURCE: Record<string, string> = { glofas: "GloFAS river flow", rain: "NOAA GEFS catchment rainfall", heat: "NOAA GEFS temperature", "heat-ecmwf": "ECMWF ENS temperature", wind: "NOAA GEFS gusts", "wind-ecmwf": "ECMWF ENS gusts" }

    const ABI = [
        "function createProgram(address[] oracles_, uint256 quorum, uint256 amountPerHousehold, uint256 triggerThreshold, uint256 claimWindow, uint256 seasonEnd, string metadata_) returns (uint256 programId)",
        "event ProgramCreated(uint256 indexed programId, address coordinator, uint256 amountPerHousehold, uint256 triggerThreshold, string metadata)",
        "function token() view returns (address)"
    ]

    let advanced = $state(false)
    let busy = $state(false)
    let msg = $state("")
    let done = $state<{ id: string; tx: string; join: string; qr: string } | null>(null)

    const built = $derived(metaOf())
    const seasonEndUnix = $derived(Math.floor(Date.parse(draft.seasonEnd + "T23:59:59Z") / 1000))

    /** Everything createProgram() would revert on (BadParams), said before the wallet opens. */
    function problems(): string | null {
        if ("error" in built) return built.error
        const os = oracleList()
        if (!os.length || os.some((o) => !isAddress(o))) return "Every oracle must be an address (0x…)."
        if (new Set(os.map((o) => o.toLowerCase())).size !== os.length) return "An oracle is listed twice."
        if (!(draft.quorum >= 1 && draft.quorum <= os.length)) return `Quorum must be from 1 to ${os.length}.`
        if (!(Number(draft.amount) > 0)) return "Amount per household must be more than 0 USDC."
        if (!(draft.trigger >= 1 && draft.trigger <= 100)) return "Trigger must be from 1 to 100%."
        if (!(draft.claimDays > 0 && draft.claimDays <= 365)) return "Claim window must be from 1 to 365 days."
        if (!(seasonEndUnix > Date.now() / 1000)) return "The season must end in the future."
        return null
    }
    const blocker = $derived(problems())

    async function launch() {
        if (blocker || "error" in built) return void (msg = blocker ?? "")
        const eth = browserWallet()
        if (!eth) return void (msg = "No browser wallet found. Install one (MetaMask, Coinbase Wallet, Rabby…) or use `node scripts/coordinator.js create`.")
        busy = true
        msg = "Waiting for your wallet…"
        try {
            const signer = await walletSigner(eth)
            const c = new Contract(d.naungan, ABI, signer)
            const dec = await new Contract(await c.token(), ERC20_ABI, signer).decimals()
            const oracles = oracleList().map((o) => getAddress(o))
            msg = "Confirm the transaction in your wallet…"
            const tx = await c.createProgram(oracles, draft.quorum, parseUnits(draft.amount, dec), draft.trigger, Math.round(draft.claimDays * 86400), seasonEndUnix, JSON.stringify(built.meta))
            msg = "Creating the program on-chain…"
            const rcpt = await tx.wait()
            // The id from the receipt: a load-balanced public RPC can answer programCount() from a stale node.
            const ev = rcpt.logs.map((l: { topics: string[]; data: string }) => { try { return c.interface.parseLog(l) } catch { return null } }).find((e: { name?: string } | null) => e?.name === "ProgramCreated")
            if (!ev) throw new Error("the transaction succeeded but emitted no ProgramCreated event")
            const id = String(ev.args.programId)
            const join = `${location.origin}/claim#join=${id}`
            done = { id, tx: tx.hash, join, qr: await QRCode.toString(join, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) }
            msg = ""
        } catch (e) {
            msg = cancelled(e) ? "Cancelled in the wallet. Nothing was created." : `Could not create the program: ${why(e)}`
        } finally {
            busy = false
        }
    }
</script>

<article class="panel step" aria-labelledby="termsH">
    <h2 id="termsH"><span class="n">4</span> Terms</h2>
    <div class="fields">
        <label class="wide">Program name<input bind:value={draft.name} oninput={() => (draft.nameEdited = true)} maxlength="120" /></label>
        <label>Per household (USDC)<input type="number" min="0.01" step="0.01" bind:value={draft.amount} /></label>
        <label>Claim window (days)<input type="number" min="1" max="365" step="1" bind:value={draft.claimDays} /></label>
        <label>Season ends<input type="date" bind:value={draft.seasonEnd} /></label>
        <label>Households to cover<input type="number" min="1" step="1" bind:value={draft.households} placeholder="for the budget" /></label>
    </div>
    {#if Number(draft.households) > 0 && Number(draft.amount) > 0}
        <p class="fine" id="budget">
            Funding needed to pay them all: <b>{(Number(draft.households) * Number(draft.amount)).toLocaleString("en", { maximumFractionDigits: 2 })} USDC</b>{#if draft.people}, for {Number(draft.households).toLocaleString("en")} households among the about {draft.people.toLocaleString("en")} people within 5 km{/if}. Not written on-chain: the program pays whoever is enrolled, up to what it holds.
        </p>
    {/if}
    <label class="check"><input type="checkbox" checked={draft.second} onchange={(e) => setSecond(e.currentTarget.checked)} /> Require a second, independent forecast to agree (2-of-2)</label>
    {#if draft.second}
        <p class="fine">Claims open only when both agree: {PAIRS[draft.hazard].map((p) => SOURCE[p]).join(" and ")}, each reported by its own Naungan key, so one model’s false alarm cannot release the money.{draft.hazard !== "flood" ? " ECMWF forecasts 14 days ahead at most." : ""}</p>
    {/if}
    <p class="fine">
        Oracle{draft.second ? "s" : ""}: {draft.second ? "Naungan’s two hosted keys" : "Naungan’s hosted oracle"} <code>{oracleList().join(", ")}</code>, quorum {draft.quorum}.
        <button class="link" type="button" onclick={() => (advanced = !advanced)} aria-expanded={advanced}>{advanced ? "Hide" : "Use other oracles"}</button>
    </p>
    {#if advanced}
        <div class="fields">
            <label class="wide">Oracle addresses (comma or space separated)<textarea rows="2" bind:value={draft.oracles}></textarea></label>
            <label>Quorum<input type="number" min="1" max={Math.max(1, oracleList().length)} step="1" bind:value={draft.quorum} /></label>
        </div>
    {/if}
    <details>
        <summary>Metadata written on-chain</summary>
        <pre class="evidence">{"meta" in built ? JSON.stringify(built.meta, null, 2) : built.error}</pre>
    </details>
</article>

<article class="panel step" aria-labelledby="goH">
    <h2 id="goH"><span class="n">5</span> Launch</h2>
    {#if done}
        <p class="verdict ok">Program #{done.id} is live. {#if d.explorer}<a href="{d.explorer}/tx/{done.tx}" target="_blank" rel="noopener">View the transaction</a>{/if}</p>
        <ol class="next">
            <li><a class="btn dark" href="dashboard?program={done.id}#fund">Fund program #{done.id}</a> so it can pay.</li>
            <li>
                Households register with their own phones at this link, and agency staff <a href="enroll?program={done.id}">enroll their codes</a> by scanning them:
                <div class="joinqr" aria-hidden="true">{@html done.qr}</div>
                <code class="joinurl">{done.join}</code> <a href="poster?program={done.id}" target="_blank" rel="noopener">Print a poster with this code</a>
            </li>
            <li>
                {#if oracleList().some((o) => o.toLowerCase() === HOSTED_ORACLE.toLowerCase())}
                    Naungan’s hosted oracle finds programs it is an oracle of on-chain: it reports on <b>#{done.id}</b> from its
                    next run (every 6 hours) with no further setup.
                {/if}
                Any other oracle key runs <code>node scripts/oracle.js --all</code> (every live program it is an oracle of), on a schedule.
            </li>
        </ol>
    {:else}
        <p class="fine">Your wallet becomes the program’s coordinator. Creating it costs only gas; funding comes next, on the dashboard.</p>
        <button class="btn go" type="button" onclick={launch} disabled={busy || !!blocker}>{busy ? "Working…" : "Connect wallet and create program"}</button>
        {#if blocker && !busy}<p class="fine">{blocker}</p>{/if}
    {/if}
    {#if msg}<p class="verdict" role="status">{msg}</p>{/if}
</article>

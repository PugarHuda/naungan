<script lang="ts">
    // Cross-agency dedup in the browser, by exchanging two files (exchange.ts): before enrolling its list, an agency
    // learns which of its households another agency of the program already serves, and neither ever sees the other's
    // list. Names stay on this computer: only blinded curve points leave it, in a file the agency sends itself.
    import { onMount } from "svelte"
    import { Contract, getBytes } from "ethers"
    import { deployment as d, naungan, readPrograms, isOver, short, NAUNGAN_ABI, type Program, type ProgramMeta } from "../shared/chain"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import { download, cell } from "../shared/download"
    import { parseHouseholds } from "../../../lib/households.mjs"
    import { PROFILES, DEFAULT_PROFILE } from "../../../lib/psi.mjs"
    import { digest, makeRequest, checkRequest, makeResponse, checkResponse, type Request } from "./exchange"
    import type { Job } from "./worker"

    type Rec = { name: string; birthYear: number; village: string; commitment?: bigint }
    const c = naungan()
    const reader = new Contract(d.naungan, [...NAUNGAN_ABI, "function isAgency(uint256, address) view returns (bool)"], c.runner)
    const isAgency = (p: bigint, who: string) => reader.isAgency(p, who) as Promise<boolean>

    let programs = $state<{ id: number; p: Program; meta: ProgramMeta }[] | null>(null)
    let loadErr = $state("")
    let pid = $state<number | null>(Number(new URLSearchParams(location.search).get("program")) || null)
    let names = $state(DEFAULT_PROFILE)
    let role = $state<"ask" | "answer">(location.hash === "#answer" ? "answer" : "ask")
    let records = $state.raw<Rec[]>([])
    let listName = $state("")
    let listErr = $state("")
    let msg = $state("")
    let busy = $state(false)
    let result = $state.raw<{ dup: Set<number>; near: Set<number>; peer: string } | null>(null)

    const open = $derived((programs ?? []).filter((x) => x.p.claimDeadline === 0n && !isOver(x.p)))
    const PENDING = "naungan-dedup-pending" // this tab's open request: survives a reload, gone when the tab closes

    onMount(async () => {
        try {
            programs = await readPrograms(c)
            if (!open.some((x) => x.id === pid)) pid = open[0]?.id ?? null
        } catch (e) {
            loadErr = `Could not read the programs from the chain: ${why(e)}`
        }
    })
    $effect(() => { if (pid != null) history.replaceState(null, "", `?program=${pid}${role === "answer" ? "#answer" : ""}`) })

    const pending = () => {
        try { return JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as { request: Request; secret: string; layout: { i: number; near: boolean }[]; csv: string; names: string } | null } catch { return null }
    }
    let waiting = $state.raw(pending()) // raw: it is posted to the worker, and Svelte proxies cannot be cloned

    function run<T>(job: Job): Promise<T> {
        const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
        return new Promise<T>((resolve, reject) => {
            w.onmessage = (e) => (w.terminate(), e.data.error ? reject(new Error(e.data.error)) : resolve(e.data))
            w.onerror = (e) => (w.terminate(), reject(new Error(e.message || "the matching worker failed")))
            w.postMessage(job)
        })
    }
    // Measured: ~35 s per 1,000 households on a laptop, for each side (hash-to-curve in JavaScript).
    const eta = (n: number) => (n < 300 ? "" : ` (about ${Math.max(1, Math.round((n * 0.035) / 60))} min, keep this tab open)`)
    const plain = (rs: Rec[]) => rs.map(({ name, birthYear, village }) => ({ name, birthYear, village })) // what the worker needs: no commitments

    let csvText = ""
    async function readList(file: File | undefined) {
        result = null
        listErr = ""
        if (!file) return
        csvText = await file.text()
        listName = file.name
        try {
            records = parseHouseholds(csvText, pid ?? undefined, file.name)
            if (!records.length) throw new Error(`${file.name} has no households under its header row`)
        } catch (e) {
            records = []
            listErr = (e as Error).message
        }
    }
    const readJson = async (file: File | undefined) => {
        if (!file) throw new Error("no file chosen")
        try { return JSON.parse(await file.text()) } catch { throw new Error(`${file.name} is not a dedup file (not JSON)`) }
    }
    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")

    async function ask() {
        busy = true
        try {
            const eth = browserWallet()
            if (!eth) throw new Error("no browser wallet found. The request is signed by your agency's wallet (MetaMask, Coinbase Wallet, Rabby…), so the other agency knows it comes from an agency of this program")
            msg = "Waiting for your wallet…"
            const signer = await walletSigner(eth)
            const from = await signer.getAddress()
            if (!(await isAgency(BigInt(pid!), from))) throw new Error(`${short(from)} is not an agency of program #${pid}, so the other agency would refuse the request. Ask the program's coordinator to add it.`)
            msg = `Blinding ${records.length} households on this computer…${eta(records.length)}`
            const { points, secret, layout } = await run<{ points: string[]; secret: string; layout: { i: number; near: boolean }[] }>({ op: "request", records: plain(records), names })
            const ts = Date.now()
            msg = "Sign the request in your wallet (a signature, no transaction)…"
            const signature = await signer.signMessage(getBytes(digest(BigInt(pid!), ts, points)))
            const request = makeRequest({ names, chainId: d.chainId, naungan: d.naungan, program: BigInt(pid!), ts, from, signature, points })
            const keep = { request, secret, layout, csv: csvText, names }
            try { sessionStorage.setItem(PENDING, JSON.stringify(keep)) } catch {}
            waiting = keep
            download(`naungan-dedup-request-p${pid}-${stamp()}.json`, "application/json", JSON.stringify(request))
            msg = ""
        } catch (e) {
            msg = cancelled(e) ? "Cancelled in the wallet." : `Could not make the request: ${why(e)}`
        } finally {
            busy = false
        }
    }

    async function finish(file: File | undefined) {
        busy = true
        try {
            const w = waiting!
            const response = checkResponse(await readJson(file), w.request)
            msg = "Matching on this computer…"
            const own = parseHouseholds(w.csv, BigInt(w.request.program))
            const out = await run<{ dup: number[]; near: number[] }>({ op: "intersect", records: plain(own), names: w.names, secret: w.secret, layout: w.layout, doubled: response.doubled, own: response.own })
            records = own
            result = { dup: new Set(out.dup), near: new Set(out.near), peer: file!.name }
            msg = ""
        } catch (e) {
            msg = `Could not read the answer: ${why(e)}`
        } finally {
            busy = false
        }
    }

    let answered = $state<{ from: string; program: string; keys: number; mine: number } | null>(null)
    async function answer(file: File | undefined) {
        busy = true
        answered = null
        try {
            const q = await readJson(file)
            msg = "Checking the request against the chain…"
            const from = await checkRequest(q, { names, chainId: d.chainId, naungan: d.naungan }, isAgency)
            msg = `Blinding your ${records.length} households and theirs on this computer…${eta(records.length + q.points.length / 16)}`
            const r = await run<{ doubled: string[]; own: string[] }>({ op: "respond", records: plain(records), names, points: q.points })
            download(`naungan-dedup-answer-p${q.program}-${stamp()}.json`, "application/json", JSON.stringify(makeResponse(q, r)))
            answered = { from, program: q.program, keys: q.points.length, mine: records.length }
            msg = ""
        } catch (e) {
            msg = `Not answered: ${why(e)}`
        } finally {
            busy = false
        }
    }

    const fresh = $derived(result ? records.filter((_, i) => !result!.dup.has(i) && !result!.near.has(i)) : [])
    const toCsv = (rs: Rec[]) => ["name,birthYear,village,commitment", ...rs.map((r) => [r.name, r.birthYear, r.village, r.commitment ?? ""].map(cell).join(","))].join("\r\n") + "\r\n"
    const base = () => listName.replace(/\.csv$/i, "") || "households"
    // Households that registered on their own phones carry a commitment: they can go straight to the enrollment page.
    function toEnroll() {
        const p = result && waiting ? waiting.request.program : String(pid)
        const k = `naungan-enroll-${d.naungan}-${p}`
        let list: string[] = []
        try { list = JSON.parse(localStorage.getItem(k) ?? "[]") } catch {}
        const add = fresh.filter((r) => r.commitment !== undefined).map((r) => r.commitment!.toString())
        try { localStorage.setItem(k, JSON.stringify([...new Set([...list, ...add])])) } catch {}
        location.href = `enroll?program=${p}`
    }
    function done() {
        try { sessionStorage.removeItem(PENDING) } catch {}
        ;(waiting = null), (result = null)
    }
</script>

<div class="frame">
    <nav aria-label="Dedup">
        <a class="brand" href="./">NAUNGAN</a>
        <div class="navlinks">
            <span class="net">{d.network} {#if d.explorer}<a href="{d.explorer}/address/{d.naungan}" target="_blank" rel="noopener">{short(d.naungan)}</a>{:else}{short(d.naungan)}{/if}</span>
            <a class="btn ghost" href="enroll">Enroll</a>
        </div>
    </nav>
    <main class="launch">
        <header>
            <h1>Check a list against another agency</h1>
            <p class="say">Before you enroll, find the households another agency of the program already serves, without either of you showing the other a single name. Names never leave this computer: you exchange two files of blinded keys (private set intersection), and only you learn the overlap.</p>
        </header>

        <article class="panel step" aria-labelledby="setH">
            <h2 id="setH"><span class="n">1</span> Program and your list</h2>
            {#if loadErr}<p class="verdict" role="alert">{loadErr}</p>
            {:else if !programs}<p class="fine">Reading programs from the chain…</p>
            {:else if !open.length}<p class="fine">No program is open for enrollment right now.</p>
            {:else}
                <label>Program
                    <select bind:value={pid}>
                        {#each open as x (x.id)}<option value={x.id}>#{x.id} · {x.meta.name ?? "Program " + x.id}</option>{/each}
                    </select>
                </label>
                <label>How names are matched (both agencies must choose the same)
                    <select bind:value={names}>
                        {#each Object.keys(PROFILES) as k (k)}<option value={k}>{k === "id" ? "id: Indonesian and Malay titles and spelling" : "basic: accents, case and honorifics only"}</option>{/each}
                    </select>
                </label>
                <label>Your household list (CSV with columns name, birthYear, village; optional commitment)
                    <input type="file" accept=".csv,text/csv" onchange={(e) => readList(e.currentTarget.files?.[0])} />
                </label>
                {#if listErr}<p class="verdict" role="alert">{listErr}</p>{:else if records.length}<p class="fine"><b>{records.length}</b> households read from {listName}. They stay on this computer.</p>{/if}
            {/if}
        </article>

        {#if pid != null && open.length}
            <div class="tabs" role="group" aria-label="Your side">
                <button type="button" class="btn {role === 'ask' ? 'dark' : 'ghost'}" aria-pressed={role === "ask"} onclick={() => (role = "ask")}>I am enrolling: ask</button>
                <button type="button" class="btn {role === 'answer' ? 'dark' : 'ghost'}" aria-pressed={role === "answer"} onclick={() => (role = "answer")}>Another agency asked me: answer</button>
            </div>

            {#if role === "ask"}
                <article class="panel step" aria-labelledby="askH">
                    <h2 id="askH"><span class="n">2</span> Ask</h2>
                    {#if !waiting}
                        <p class="fine">Your agency wallet signs the request (no transaction, no gas), so the other agency can check on-chain that it comes from an agency of program #{pid}. Send them the file it downloads.</p>
                        <button class="btn go" type="button" onclick={ask} disabled={busy || !records.length}>{busy ? "Working…" : "Sign and download the request"}</button>
                    {:else if !result}
                        <p class="fine">Request for program #{waiting.request.program} made {new Date(waiting.request.ts).toLocaleString()} ({waiting.request.points.length} blinded keys). Keep this tab open until their answer arrives, then open it here.</p>
                        <label>Their answer file
                            <input type="file" accept=".json,application/json" onchange={(e) => finish(e.currentTarget.files?.[0])} disabled={busy} />
                        </label>
                        <button class="link" type="button" onclick={done}>Start over</button>
                    {/if}
                    {#if result}
                        <p class="verdict ok" role="status"><b>{result.dup.size}</b> already served by the other agency · <b>{result.near.size}</b> possible (birth year one off, or a one-letter typo: check with them) · <b>{fresh.length}</b> new</p>
                        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                        <div class="scroll" tabindex="0" role="region" aria-label="Result for each household">
                        <table class="dedup">
                            <thead><tr><th scope="col">Household</th><th scope="col">Born</th><th scope="col">Village</th><th scope="col">Result</th></tr></thead>
                            <tbody>
                                {#each records as r, i (i)}
                                    <tr class={result.dup.has(i) ? "dup" : result.near.has(i) ? "near" : ""}><td>{r.name}</td><td>{r.birthYear}</td><td>{r.village}</td><td>{result.dup.has(i) ? "Already served" : result.near.has(i) ? "Check" : "New"}</td></tr>
                                {/each}
                            </tbody>
                        </table>
                        </div>
                        <div class="row">
                            <button class="btn ghost" type="button" onclick={() => download(`${base()}.new.csv`, "text/csv", toCsv(fresh))} disabled={!fresh.length}>Download the {fresh.length} new</button>
                            <button class="btn ghost" type="button" onclick={() => download(`${base()}.review.csv`, "text/csv", toCsv(records.filter((_, i) => result!.near.has(i))))} disabled={!result.near.size}>Download the {result.near.size} to check</button>
                            {#if fresh.some((r) => r.commitment !== undefined)}
                                <button class="btn go" type="button" onclick={toEnroll}>Enroll the {fresh.filter((r) => r.commitment !== undefined).length} new with registration codes</button>
                            {/if}
                        </div>
                        {#if fresh.some((r) => r.commitment === undefined)}<p class="fine cli">New households without a registration code need printed claim cards: <code>node scripts/agency.js enroll --program {waiting?.request.program} --list {base()}.new.csv --claim-url {location.origin}/claim --cards cards.html --pin</code></p>{/if}
                        <button class="link" type="button" onclick={done}>Check another list</button>
                    {/if}
                </article>
            {:else}
                <article class="panel step" aria-labelledby="ansH">
                    <h2 id="ansH"><span class="n">2</span> Answer</h2>
                    <p class="fine">Open the request file the other agency sent. It is answered only if an agency of its program signed it on this contract. They learn which of their households you serve; you learn only how many keys they sent.</p>
                    <label>Their request file
                        <input type="file" accept=".json,application/json" onchange={(e) => answer(e.currentTarget.files?.[0])} disabled={busy || !records.length} />
                    </label>
                    {#if !records.length}<p class="fine">Choose your own household list above first.</p>{/if}
                    {#if answered}<p class="verdict ok" role="status">Answered {short(answered.from)} (an agency of program #{answered.program}): {answered.keys} keys blinded, your {answered.mine} households sent back blinded and shuffled. Send them the downloaded answer file.</p>{/if}
                </article>
            {/if}
            {#if msg}<p class="verdict" role="status">{msg}</p>{/if}
        {/if}
    </main>
</div>

<style>
    .panel { min-width: 0 } /* a grid item: the results table scrolls inside it instead of widening the page */
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 }
    .scroll { overflow-x: auto; margin-top: 12px }
    .dedup { width: 100%; border-collapse: collapse; font-size: 14px }
    .dedup th, .dedup td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line, #ddd) }
    .dedup tr.dup td { text-decoration: line-through; opacity: .7 }
    .dedup tr.near td:last-child { font-weight: 700 }
    .cli code { overflow-wrap: anywhere }
</style>

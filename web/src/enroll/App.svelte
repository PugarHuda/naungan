<script lang="ts">
    // Agency enrollment in the browser: households register on their own phones (claim.html#join=<program>) and show
    // a code; staff scan or paste the codes here and enroll them from the agency's wallet. The page sees only public
    // commitments: no names, and no secret that could ever claim for anyone. Cross-agency dedup of name lists stays
    // in scripts/agency.js (PSI); self-registered phones carry no names, so a phone can be enrolled only once per program.
    import { onMount, tick } from "svelte"
    import { Contract } from "ethers"
    import { deployment as d, naungan, readPrograms, isOver, short, NAUNGAN_ABI, type Program, type ProgramMeta } from "../shared/chain"
    import { browserWallet, cancelled, walletSigner, why } from "../shared/wallet"
    import { readCode, codesIn, chunks } from "./codes"

    const ABI = [...NAUNGAN_ABI, "function isAgency(uint256, address) view returns (bool)", "function addAgency(uint256 programId, address agency)", "function enroll(uint256 programId, uint256[] commitments)"]
    const c = naungan()
    const reader = new Contract(d.naungan, ABI, c.runner)

    let programs = $state<{ id: number; p: Program; meta: ProgramMeta }[] | null>(null)
    let loadErr = $state("")
    let pid = $state<number | null>(Number(new URLSearchParams(location.search).get("program")) || null)
    let enrolled = $state(new Set<string>())
    let list = $state<string[]>([])
    let refused = $state<{ code: string; why: string }[]>([])
    let paste = $state("")
    let msg = $state("")
    let done = $state<{ n: number; txs: string[] } | null>(null)
    let busy = $state(false)
    let needAgency = $state<string | null>(null) // the connected wallet is this program's coordinator but not yet an agency

    // Open programs only: enrollment is refused once a trigger has fired or the season is over.
    const open = $derived((programs ?? []).filter((x) => x.p.claimDeadline === 0n && !isOver(x.p)))
    const chosen = $derived(open.find((x) => x.id === pid))
    const KEY = $derived(`naungan-enroll-${d.naungan}-${pid}`) // the scanned list survives a reload in the field (commitments are not secret)

    onMount(async () => {
        try {
            programs = await readPrograms(c)
            if (!open.some((x) => x.id === pid)) pid = open[0]?.id ?? null
        } catch (e) {
            loadErr = `Could not read the programs from the chain: ${why(e)}`
        }
    })

    // Switching program: load who is already enrolled, and this program's saved list.
    $effect(() => {
        if (pid == null) return
        const id = pid
        history.replaceState(null, "", `?program=${id}`)
        try {
            list = JSON.parse(localStorage.getItem(`naungan-enroll-${d.naungan}-${id}`) ?? "[]")
        } catch {
            list = []
        }
        ;(refused = []), (done = null), (needAgency = null), (msg = "")
        c.members(id).then((m: bigint[]) => { if (pid === id) enrolled = new Set(m.map(String)) }).catch(() => {})
    })
    $effect(() => {
        const k = KEY, v = JSON.stringify(list)
        try { localStorage.setItem(k, v) } catch {}
    })

    function add(raw: string) {
        const v = readCode(raw, BigInt(pid!), new Set(list), enrolled)
        if (v.ok) list = [...list, v.commitment]
        else refused = [...refused.filter((r) => r.code !== raw), { code: raw, why: v.why }]
        return v.ok
    }
    function addPasted() {
        const found = codesIn(paste)
        if (!found.length) return void (msg = "No registration codes found in that text. Codes look like naungan-commitment:<program>:<number>.")
        const n = found.filter(add).length
        msg = `Added ${n} of ${found.length} code${found.length === 1 ? "" : "s"}.`
        paste = ""
    }

    // Continuous scanning: the camera stays on and each new code is added (with a short vibration) until Stop.
    let video = $state<HTMLVideoElement>()
    let stream: MediaStream | null = null
    let scanning = $state(false)
    const stop = () => (stream?.getTracks().forEach((x) => x.stop()), (stream = null), (scanning = false))
    async function scan() {
        if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return void (msg = "This browser cannot read QR codes from the camera (it needs Chrome on Android, or Edge). Paste the codes below instead.")
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        } catch {
            return void (msg = "Camera permission was refused. Allow it in the browser settings, or paste the codes below.")
        }
        scanning = true
        await tick()
        video!.srcObject = stream
        await video!.play()
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] })
        let last = ""
        while (stream?.active) {
            const [code] = await detector.detect(video).catch(() => [])
            if (code && code.rawValue !== last) {
                last = code.rawValue
                if (add(code.rawValue)) (msg = `Added: household ${list.length}.`), navigator.vibrate?.(80)
                else msg = `Not added: ${refused.at(-1)?.why}.`
            }
            await new Promise((r) => setTimeout(r, 250))
        }
    }

    async function connect() {
        const eth = browserWallet()
        if (!eth) throw new Error("no browser wallet found. Install one (MetaMask, Coinbase Wallet, Rabby…) or use `node scripts/agency.js enroll`")
        const signer = await walletSigner(eth)
        return { signer, me: await signer.getAddress() }
    }

    async function becomeAgency() {
        busy = true
        try {
            const { signer, me } = await connect()
            msg = "Confirm adding your wallet as an agency…"
            const tx = await (reader.connect(signer) as Contract).addAgency(pid, me)
            if ((await tx.wait()).status !== 1) throw new Error("the transaction reverted")
            needAgency = null
            msg = `${short(me)} is now an agency of program #${pid}. Enroll the households now.`
        } catch (e) {
            msg = cancelled(e) ? "Cancelled in the wallet." : `Could not add the agency: ${why(e)}`
        } finally {
            busy = false
        }
    }

    async function enroll() {
        busy = true
        done = null
        try {
            const id = pid!
            msg = "Waiting for your wallet…"
            const { signer, me } = await connect()
            if (!(await reader.isAgency(id, me))) {
                const coordinator = (await c.programs(id)).coordinator as string
                if (coordinator.toLowerCase() === me.toLowerCase()) return void ((needAgency = me), (msg = `${short(me)} created program #${id} but is not one of its agencies yet.`))
                return void (msg = `${short(me)} is not an agency of program #${id}. Ask its coordinator (${short(coordinator)}) to add this address as an agency.`)
            }
            // Re-read the chain right before sending: another agency may have enrolled some of these phones meanwhile.
            const on = new Set(((await c.members(id)) as bigint[]).map(String))
            const fresh = list.filter((x) => !on.has(x))
            if (!fresh.length) return void ((list = []), (enrolled = on), (msg = "Every household in the list is already enrolled."))
            const parts = chunks(fresh)
            const txs: string[] = []
            for (const [i, part] of parts.entries()) {
                msg = parts.length > 1 ? `Confirm transaction ${i + 1} of ${parts.length} (${part.length} households)…` : `Confirm enrolling ${part.length} household${part.length === 1 ? "" : "s"}…`
                const tx = await (reader.connect(signer) as Contract).enroll(id, part)
                msg = "Enrolling on-chain…"
                if ((await tx.wait()).status !== 1) throw new Error("the enrollment transaction reverted")
                txs.push(tx.hash)
                for (const x of part) on.add(x)
                list = list.filter((x) => !on.has(x)) // what is on-chain leaves the list, so a failure later resumes where it stopped
            }
            enrolled = on
            done = { n: fresh.length, txs }
            msg = ""
        } catch (e) {
            msg = cancelled(e) ? "Cancelled in the wallet. Households not yet sent stay in the list." : `Could not enroll: ${why(e)}`
        } finally {
            busy = false
        }
    }
</script>

<div class="frame">
    <nav aria-label="Enroll">
        <a class="brand" href="./">NAUNGAN</a>
        <div class="navlinks">
            <span class="net">{d.network} {#if d.explorer}<a href="{d.explorer}/address/{d.naungan}" target="_blank" rel="noopener">{short(d.naungan)}</a>{:else}{short(d.naungan)}{/if}</span>
            <a class="btn ghost" href="dashboard.html">Live programs</a>
        </div>
    </nav>
    <main class="launch">
        <header>
            <h1>Enroll households</h1>
            <p class="say">Households register on their own phones and show a code. Scan or paste the codes here, then enroll them from your agency’s wallet. This page never sees a name, and nothing on it can claim for anyone.</p>
        </header>

        <article class="panel step" aria-labelledby="progH">
            <h2 id="progH"><span class="n">1</span> Program</h2>
            {#if loadErr}<p class="verdict" role="alert">{loadErr}</p>
            {:else if !programs}<p class="fine">Reading programs from the chain…</p>
            {:else if !open.length}<p class="fine">No program is open for enrollment right now (each closes when its trigger fires or its season ends).</p>
            {:else}
                <label>Program open for enrollment
                    <select bind:value={pid}>
                        {#each open as x (x.id)}<option value={x.id}>#{x.id} · {x.meta.name ?? "Program " + x.id}</option>{/each}
                    </select>
                </label>
                {#if chosen}
                    <p class="fine">{enrolled.size} household{enrolled.size === 1 ? "" : "s"} enrolled so far. Registration link for phones: <code>{location.origin}/claim.html#join={chosen.id}</code> · <a href="poster.html?program={chosen.id}" target="_blank" rel="noopener">Print a registration poster</a></p>
                {/if}
            {/if}
        </article>

        {#if chosen}
            <article class="panel step" aria-labelledby="codesH">
                <h2 id="codesH"><span class="n">2</span> Codes</h2>
                <button class="btn dark" type="button" onclick={scanning ? stop : scan}>{scanning ? "Stop camera" : "Scan with the camera"}</button>
                {#if scanning}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video bind:this={video} playsinline muted class="scanner"></video>
                {/if}
                <label class="pastebox">Or paste codes (one per line, or a CSV that contains them)
                    <textarea rows="3" bind:value={paste} placeholder="naungan-commitment:{chosen.id}:…"></textarea>
                </label>
                <button class="btn ghost" type="button" onclick={addPasted} disabled={!paste.trim()}>Add pasted codes</button>
                <p class="ready" aria-live="polite"><b>{list.length}</b> household{list.length === 1 ? "" : "s"} ready to enroll</p>
                {#if list.length}<button class="link" type="button" onclick={() => (list = [])}>Clear the list</button>{/if}
                {#if refused.length}
                    <details open={refused.length < 4}>
                        <summary>{refused.length} code{refused.length === 1 ? "" : "s"} not added</summary>
                        <ul class="goev">{#each refused as r (r.code)}<li><code>{r.code.length > 60 ? r.code.slice(0, 60) + "…" : r.code}</code> <small>{r.why}</small></li>{/each}</ul>
                    </details>
                {/if}
            </article>

            <article class="panel step" aria-labelledby="goH">
                <h2 id="goH"><span class="n">3</span> Enroll</h2>
                {#if done}
                    <p class="verdict ok">{done.n} household{done.n === 1 ? "" : "s"} enrolled in program #{chosen.id}. Their phones show “enrolled” the next time they open.{#if d.explorer}{#each done.txs as h, i (h)} <a href="{d.explorer}/tx/{h}" target="_blank" rel="noopener">Transaction{done.txs.length > 1 ? ` ${i + 1}` : ""}</a>{/each}{/if}</p>
                {/if}
                <p class="fine">Your wallet must be one of the program’s agencies. Enrolling costs gas only; up to 100 households go in each transaction.</p>
                {#if needAgency}
                    <button class="btn dark" type="button" onclick={becomeAgency} disabled={busy}>Add {short(needAgency)} as an agency</button>
                {/if}
                <button class="btn go" type="button" onclick={enroll} disabled={busy || !list.length}>{busy ? "Working…" : list.length ? `Connect wallet and enroll ${list.length}` : "Connect wallet and enroll"}</button>
                {#if msg}<p class="verdict" role="status">{msg}</p>{/if}
            </article>
        {/if}
    </main>
</div>

<style>
    .scanner { width: 100%; max-width: 420px; border-radius: 14px; margin-top: 12px; display: block }
    .pastebox { margin: 14px 0 8px }
    .ready { font-size: 17px; margin: 16px 0 4px }
</style>

<script lang="ts">
    // Wallets on this phone that hold USDC, and paying a shop or cash-out agent from one. The wallet holds no
    // ETH: it signs an EIP-3009 transferWithAuthorization (Circle USDC supports it natively) and the relayer
    // submits it, so cashing out needs no gas token.
    import { tick } from "svelte"
    import { ethers } from "ethers"
    import { deployment as d } from "../shared/chain"
    import { t, type Funded } from "./state.svelte"
    import { RELAYER, usdc, walletPanel } from "./flow"
    import Money from "./Money.svelte"

    let { funded, dec }: { funded: Funded[]; dec: bigint } = $props()
    // One phone can hold several households' wallets: pick which one to spend from, never a merged total.
    let picked = $state("")
    const cur = $derived(funded.find((x) => x.wallet.address === picked) ?? funded[0])
    const bal = $derived(ethers.formatUnits(cur.bal, dec))
    let to = $state(""), amt = $state("")
    let busy = $state(false), scanning = $state(false)
    let msg = $state<{ text: string; ok: boolean } | null>(null)
    let toInput: HTMLInputElement, amtInput: HTMLInputElement
    let video = $state<HTMLVideoElement>()!

    async function send() {
        let dest: string, value: bigint
        try { dest = ethers.getAddress(to.trim()) } catch { return toInput.setCustomValidity(t("to")), toInput.reportValidity() }
        toInput.setCustomValidity("")
        try { value = ethers.parseUnits(amt.trim() || "0", dec) } catch { value = 0n }
        const w = cur.wallet, before = cur.bal
        if (value <= 0n || value > before) return amtInput.setCustomValidity(t("badAmt")), amtInput.reportValidity()
        amtInput.setCustomValidity("")
        busy = true
        msg = null
        try {
            const token = usdc()
            const [name, version] = await Promise.all([token.name(), token.version()])
            const now = Math.floor(Date.now() / 1000)
            const m = { from: w.address, to: dest, value, validAfter: now - 60, validBefore: now + 3600, nonce: ethers.hexlify(ethers.randomBytes(32)) }
            const signature = await w.signTypedData({ name, version, chainId: d.chainId, verifyingContract: d.usdc }, {
                TransferWithAuthorization: [
                    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
                    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
                ]
            }, m)
            const res = await fetch(new URL("/transfer", RELAYER), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...m, value: value.toString(), signature }) })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error)
            msg = { text: `${t("sent")} ${ethers.formatUnits(value, dec)} USDC → ${dest}`, ok: true }
            amt = ""
            await walletPanel((b) => b <= before - value, w.address)
        } catch (e: any) {
            msg = { text: `${t("err")}: ${e.message}`, ok: false }
        }
        busy = false
    }

    /**
     * Paying a shop or cash-out agent: point the camera at the QR its wallet app shows. Uses the browser's
     * own BarcodeDetector (Chrome on Android); plain addresses and EIP-681 "ethereum:0x…" links both work.
     */
    let stream: MediaStream | null = null
    const stop = () => (stream?.getTracks().forEach((x) => x.stop()), (scanning = false))
    async function scan() {
        const say = (k: string) => (msg = { text: t(k), ok: false })
        if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return say("scanNo")
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        } catch {
            return say("scanDenied")
        }
        scanning = true
        await tick() // let the <video> render
        video.srcObject = stream
        await video.play()
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] })
        for (let i = 0; i < 300 && stream.active; i++) { // about a minute, then give up quietly
            const [code] = await detector.detect(video).catch(() => [])
            if (code) {
                stop()
                const addr = code.rawValue.match(/0x[0-9a-fA-F]{40}/)?.[0]
                if (!addr) return say("scanBad")
                to = ethers.getAddress(addr.toLowerCase())
                msg = null
                return amtInput.focus()
            }
            await new Promise((r) => setTimeout(r, 200))
        }
        stop()
    }
</script>

<section class="card">
    <strong>{t("wallet")}</strong>
    {#if funded.length > 1}
        <div>
            <label for="wpick" class="privacy">{t("pickWallet")}</label>
            <select id="wpick" bind:value={picked}>
                {#each funded as x (x.wallet.address)}
                    <option value={x.wallet.address}>{x.wallet.address.slice(0, 8)}…{x.wallet.address.slice(-4)} · {ethers.formatUnits(x.bal, dec)} USDC</option>
                {/each}
            </select>
        </div>
    {/if}
    <div class="big">{bal} USDC</div>
    <div><Money usdc={bal} /></div>
    <div class="to">{cur.wallet.address}</div>
    <p class="privacy">{t("spend")}</p>
    <button class="link" type="button" style="margin-top:12px" onclick={scan}>{t("scan")}</button>
    {#if scanning}
        <div>
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={video} playsinline muted style="width:100%;border-radius:12px;margin-top:10px;background:#000"></video>
            <button class="link" type="button" aria-label="Stop scanning" onclick={stop}>✕</button>
        </div>
    {/if}
    <input type="text" autocomplete="off" spellcheck="false" aria-label="recipient address" placeholder={t("to")} bind:value={to} bind:this={toInput} />
    <input type="text" inputmode="decimal" autocomplete="off" aria-label="amount in USDC" placeholder={t("amt")} bind:value={amt} bind:this={amtInput} />
    <button class="primary" type="button" disabled={busy} onclick={send}>{t("send")}</button>
    <p class="note {msg ? (msg.ok ? 'ok' : 'bad') : ''}" id="wmsg" aria-live="polite">{msg?.text ?? ""}</p>
</section>

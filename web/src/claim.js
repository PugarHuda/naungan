// Household claim app. Bundled by `npm run build` into web/claim.js (no CDN for the crypto code).
// The identity secret arrives in the URL fragment from a QR card; fragments are never sent to any
// server, and we strip it from the address bar right away.
import { ethers } from "ethers"
import { Identity, Group, generateProof } from "@semaphore-protocol/core"
import { poseidon2 } from "poseidon-lite"

const T = {
    en: {
        title: "Claim your support", load: "Loading program…", noCard: "Scan your Naungan card with the phone camera, or paste the card code below.",
        paste: "Card code", open: "Open card", program: "Program", amount: "Amount", status: "Status",
        watching: "Watching the river. Claims open automatically when the flood forecast crosses the trigger.",
        open_: "Flood alert: claims are open", until: "until", closed: "The claim window has closed.",
        notEnrolled: "This card is not enrolled in this program. Contact your aid agency.",
        claimed: "This card has already been claimed. Each household can claim once.",
        enrolled: "Your card is valid for this program.", payTo: "Where should the money go?",
        newWallet: "Create a wallet on this phone", ownWallet: "Use my own address", addr: "Wallet address (0x…)",
        backup: "Write down this backup key and keep it safe. Anyone with it controls the money.",
        claim: "Claim now", proving: "Creating your private proof on this phone…", sending: "Sending through the relayer…",
        done: "Paid", balance: "Wallet balance", tx: "View transaction", err: "Something went wrong", underfunded: "The program has no funds left right now. Try again later.",
        offline: "No signal. Showing the program as saved on this phone at", queued: "Your claim is ready and saved on this phone. It will be sent automatically when you are back online.",
        privacy: "Your name, ID and location never leave this phone. The blockchain only learns that one enrolled household claimed."
    },
    id: {
        title: "Klaim bantuan Anda", load: "Memuat program…", noCard: "Pindai kartu Naungan dengan kamera ponsel, atau tempel kode kartu di bawah.",
        paste: "Kode kartu", open: "Buka kartu", program: "Program", amount: "Jumlah", status: "Status",
        watching: "Memantau sungai. Klaim terbuka otomatis saat prakiraan banjir melewati batas pemicu.",
        open_: "Peringatan banjir: klaim dibuka", until: "sampai", closed: "Masa klaim sudah ditutup.",
        notEnrolled: "Kartu ini tidak terdaftar di program ini. Hubungi lembaga bantuan Anda.",
        claimed: "Kartu ini sudah diklaim. Setiap keluarga hanya bisa klaim sekali.",
        enrolled: "Kartu Anda berlaku untuk program ini.", payTo: "Ke mana uang dikirim?",
        newWallet: "Buat dompet di ponsel ini", ownWallet: "Pakai alamat saya sendiri", addr: "Alamat dompet (0x…)",
        backup: "Catat kunci cadangan ini dan simpan baik-baik. Siapa pun yang memilikinya menguasai uangnya.",
        claim: "Klaim sekarang", proving: "Membuat bukti privat di ponsel ini…", sending: "Mengirim lewat relayer…",
        done: "Terbayar", balance: "Saldo dompet", tx: "Lihat transaksi", err: "Terjadi kesalahan", underfunded: "Dana program sedang habis. Coba lagi nanti.",
        offline: "Tidak ada sinyal. Menampilkan data program yang tersimpan di ponsel ini pada", queued: "Klaim Anda sudah siap dan tersimpan di ponsel ini. Akan dikirim otomatis saat sinyal kembali.",
        privacy: "Nama, NIK, dan lokasi Anda tidak pernah keluar dari ponsel ini. Blockchain hanya tahu bahwa satu keluarga terdaftar telah klaim."
    }
}
let lang = (() => { try { return localStorage.getItem("naungan-lang") } catch { return null } })() || (navigator.language?.startsWith("id") ? "id" : "en")
const t = (k) => T[lang][k]
const $ = (id) => document.getElementById(id)
const show = (id, on = true) => $(id).toggleAttribute("hidden", !on)
const scopeHash = (pid) => BigInt(ethers.keccak256(ethers.toBeHex(pid, 32))) >> 8n

const ABI = [
    "function programs(uint256) view returns (address coordinator, uint256 quorum, uint256 groupId, uint256 amountPerHousehold, uint256 triggerThreshold, uint256 claimWindow, uint256 claimDeadline, uint256 lastIndex, uint256 enrolled, uint256 funded, uint256 claims, uint256 seasonEnd)",
    "function metadata(uint256) view returns (string)",
    "function members(uint256) view returns (uint256[])",
    "function nullifierUsed(uint256, uint256) view returns (bool)"
]
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]

const state = { pid: null, identity: null }

function readCard(fragment) {
    const q = new URLSearchParams(fragment.replace(/^#/, ""))
    const pid = q.get("p"), id = q.get("id")
    if (!pid || !id || !/^\d+$/.test(pid)) return false
    state.pid = BigInt(pid)
    state.identity = Identity.import(id) // throws on a corrupted card
    try { sessionStorage.setItem("naungan-card", fragment) } catch {}
    return true
}

function render() {
    document.documentElement.lang = lang
    document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)))
    $("addr").placeholder = t("addr")
    $("lang").textContent = lang === "en" ? "Bahasa Indonesia" : "English"
}

function wallet() {
    try {
        let k = localStorage.getItem("naungan-wallet")
        if (!k) localStorage.setItem("naungan-wallet", (k = ethers.Wallet.createRandom().privateKey))
        return new ethers.Wallet(k)
    } catch {
        return (state.ephemeral ??= ethers.Wallet.createRandom()) // storage blocked: still works for this visit
    }
}

// Scanning a second card in the same tab only changes the fragment (no page load): start over
// so the new card is read and its secret is stripped from the address bar too.
window.addEventListener("hashchange", () => location.reload())

async function main() {
    render()
    $("lang").onclick = () => {
        lang = lang === "en" ? "id" : "en"
        try { localStorage.setItem("naungan-lang", lang) } catch {}
        render()
    }

    const fragment = location.hash || (() => { try { return sessionStorage.getItem("naungan-card") } catch { return null } })() || ""
    let ok = false
    try { ok = readCard(fragment) } catch { ok = false }
    if (location.hash) history.replaceState(null, "", location.pathname) // keep the secret out of history and screenshots
    if (!ok) {
        show("nocard")
        $("openCard").onclick = () => {
            const v = $("code").value.trim()
            const frag = v.includes("#") ? v.slice(v.indexOf("#")) : v
            try {
                if (readCard(frag)) return show("nocard", false), load()
            } catch {}
            $("code").setCustomValidity(t("err")), $("code").reportValidity()
        }
        return
    }
    await load()
}

const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
    del: (k) => { try { localStorage.removeItem(k) } catch {} }
}
const PENDING = "naungan-pending"
const ARTIFACT = (depth, ext) => `https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-${depth}.${ext}`
const depthOf = (n) => Math.max(1, Math.ceil(Math.log2(Math.max(n, 2))))

/** Live program state, saved on the phone so the card still works when the signal is gone. */
async function snapshot(d) {
    const key = `naungan-program-${d.naungan}-${state.pid}`
    if (!navigator.onLine && store.get(key)) return { ...store.get(key), offline: true }
    try {
        const provider = new ethers.JsonRpcProvider(d.rpc, d.chainId, { staticNetwork: true })
        const c = new ethers.Contract(d.naungan, ABI, provider)
        const usdc = new ethers.Contract(d.usdc, ERC20, provider)
        const nullifier = poseidon2([scopeHash(state.pid), state.identity.secretScalar])
        const [p, metaRaw, members, dec, claimed] = await Promise.all([c.programs(state.pid), c.metadata(state.pid), c.members(state.pid), usdc.decimals(), c.nullifierUsed(state.pid, nullifier)])
        if (!metaRaw) throw Object.assign(new Error("unknown program"), { fatal: true })
        const snap = {
            amount: p.amountPerHousehold.toString(), threshold: p.triggerThreshold.toString(), lastIndex: p.lastIndex.toString(),
            deadline: p.claimDeadline.toString(), meta: JSON.parse(metaRaw), members: members.map(String), dec: Number(dec), claimed, at: Date.now()
        }
        store.set(key, snap)
        // While there is signal, have the service worker keep the proving keys this group needs (and the next size up).
        const depth = depthOf(members.length)
        navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "prefetch", urls: [depth, depth + 1].flatMap((x) => [ARTIFACT(x, "wasm"), ARTIFACT(x, "zkey")]) }))
        return { ...snap, offline: false }
    } catch (e) {
        const cached = store.get(key)
        if (e.fatal || !cached) throw e
        return { ...cached, offline: true }
    }
}

async function relay(relayer, job) {
    const res = await fetch(new URL("/relay", relayer), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programId: job.pid, proof: job.proof }) })
    const body = await res.json()
    if (!res.ok) throw Object.assign(new Error(body.error === "Underfunded" ? t("underfunded") : body.error === "AlreadyClaimed" ? t("claimed") : body.error), { business: true })
    return body
}

async function load() {
    show("program")
    const d = await (await fetch("deployment.json")).json() // the service worker serves the last copy when offline
    const relayer = d.relayer ?? "http://localhost:8788"
    const snap = await snapshot(d)
    const amount = BigInt(snap.amount), deadline = BigInt(snap.deadline)
    const now = Math.floor(Date.now() / 1000)
    const open = deadline > 0n && now <= Number(deadline)

    $("pname").textContent = snap.meta.name
    $("pamount").textContent = `${ethers.formatUnits(amount, snap.dec)} USDC`
    $("pstatus").textContent = deadline === 0n ? t("watching") : open ? `${t("open_")} · ${t("until")} ${new Date(Number(deadline) * 1000).toLocaleString(lang)}` : t("closed")
    $("pstatus").className = open ? "pill on" : "pill"
    $("pindex").textContent = `${snap.lastIndex}% / ${snap.threshold}%`
    if (snap.offline) ($("offline").textContent = `${t("offline")} ${new Date(snap.at).toLocaleString(lang)}`), show("offline")

    const showPaid = (body) => {
        show("progress", false), show("pay", false), show("queued", false), show("done")
        $("txlink").href = d.explorer ? `${d.explorer}/tx/${body.txHash}` : "#"
        $("txlink").textContent = d.explorer ? t("tx") : body.txHash
        $("bal").textContent = `${ethers.formatUnits(amount, snap.dec)} USDC`
        $("to").textContent = `${t("balance")} ${body.payout}`
    }

    // A proof made while offline waits here and is sent the moment the phone is back online.
    const flush = async () => {
        const job = store.get(PENDING)
        if (!job || job.pid !== state.pid.toString() || !navigator.onLine) return
        try {
            const body = await relay(relayer, job)
            store.del(PENDING)
            showPaid(body)
        } catch (e) {
            if (e.business) store.del(PENDING), ($("error").textContent = `${t("err")}: ${e.message}`), show("error"), show("queued", false)
        }
    }
    window.addEventListener("online", flush)
    if (store.get(PENDING)?.pid === state.pid.toString()) {
        show("queued")
        await flush()
        return
    }

    const enrolled = snap.members.includes(state.identity.commitment.toString())
    const msg = !enrolled ? "notEnrolled" : snap.claimed ? "claimed" : "enrolled"
    $("cardmsg").dataset.t = msg
    $("cardmsg").className = enrolled && !snap.claimed ? "note ok" : "note bad"
    render()
    if (!enrolled || snap.claimed || !open) return

    show("pay")
    const w = wallet()
    const pickNew = () => {
        $("addr").value = w.address
        $("addr").readOnly = true
        $("backupKey").textContent = w.privateKey
        show("backup")
    }
    $("modeNew").onchange = pickNew
    $("modeOwn").onchange = () => ((($("addr").value = ""), ($("addr").readOnly = false)), show("backup", false))
    pickNew()

    $("claim").onclick = async () => {
        let payout
        try {
            payout = ethers.getAddress($("addr").value.trim())
        } catch {
            $("addr").setCustomValidity(t("addr")), $("addr").reportValidity()
            return
        }
        $("addr").setCustomValidity("")
        $("claim").disabled = true
        show("error", false)
        show("progress")
        let job
        try {
            $("step").dataset.t = "proving", render()
            // Re-read the group when online (it may have grown); offline, the saved group is still valid
            // because enrollment freezes when the trigger fires.
            const members = navigator.onLine ? (await snapshot(d)).members : snap.members
            const proof = await generateProof(state.identity, new Group(members.map(BigInt)), BigInt(payout), state.pid)
            job = { pid: state.pid.toString(), proof, payout }
            $("step").dataset.t = "sending", render()
            showPaid(await relay(relayer, job))
        } catch (e) {
            show("progress", false)
            if (job && !e.business) {
                store.set(PENDING, job) // no signal: keep the proof, send it automatically later
                show("pay", false), show("queued")
                return
            }
            $("error").textContent = `${t("err")}: ${e.message}`
            show("error")
            $("claim").disabled = false
        }
    }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {})

main().catch((e) => {
    $("error").textContent = `${t("err")}: ${e.message}`
    show("error")
})

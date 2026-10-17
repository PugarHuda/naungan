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
        privacy: "Nama, NIK, dan lokasi Anda tidak pernah keluar dari ponsel ini. Blockchain hanya tahu bahwa satu keluarga terdaftar telah klaim."
    }
}
let lang = (() => { try { return localStorage.getItem("naungan-lang") } catch { return null } })() || (navigator.language?.startsWith("id") ? "id" : "en")
const t = (k) => T[lang][k]
const $ = (id) => document.getElementById(id)
const show = (id, on = true) => $(id).toggleAttribute("hidden", !on)
const scopeHash = (pid) => BigInt(ethers.keccak256(ethers.toBeHex(pid, 32))) >> 8n

const ABI = [
    "function programs(uint256) view returns (address coordinator, address oracle, uint256 groupId, uint256 amountPerHousehold, uint256 triggerThreshold, uint256 claimWindow, uint256 claimDeadline, uint256 lastIndex, uint256 enrolled, uint256 funded, uint256 claims, uint256 seasonEnd)",
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

async function load() {
    show("program")
    const d = await (await fetch("deployment.json", { cache: "no-store" })).json()
    const provider = new ethers.JsonRpcProvider(d.rpc, d.chainId, { staticNetwork: true })
    const c = new ethers.Contract(d.naungan, ABI, provider)
    const usdc = new ethers.Contract(d.usdc, ERC20, provider)
    const relayer = d.relayer ?? "http://localhost:8788"
    const [p, metaRaw, members, dec] = await Promise.all([c.programs(state.pid), c.metadata(state.pid), c.members(state.pid), usdc.decimals()])
    if (!metaRaw) throw new Error("unknown program")
    const meta = JSON.parse(metaRaw)
    const nullifier = poseidon2([scopeHash(state.pid), state.identity.secretScalar])
    const claimed = await c.nullifierUsed(state.pid, nullifier)
    const now = Math.floor(Date.now() / 1000)
    const open = p.claimDeadline > 0n && now <= Number(p.claimDeadline)

    $("pname").textContent = meta.name
    $("pamount").textContent = `${ethers.formatUnits(p.amountPerHousehold, dec)} USDC`
    $("pstatus").textContent = p.claimDeadline === 0n ? t("watching") : open ? `${t("open_")} · ${t("until")} ${new Date(Number(p.claimDeadline) * 1000).toLocaleString(lang)}` : t("closed")
    $("pstatus").className = open ? "pill on" : "pill"
    $("pindex").textContent = `${p.lastIndex}% / ${p.triggerThreshold}%`

    const enrolled = members.some((m) => m === state.identity.commitment)
    const msg = !enrolled ? "notEnrolled" : claimed ? "claimed" : "enrolled"
    $("cardmsg").dataset.t = msg
    $("cardmsg").className = enrolled && !claimed ? "note ok" : "note bad"
    render()
    if (!enrolled || claimed || !open) return

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
        show("progress")
        try {
            $("step").dataset.t = "proving", render()
            const fresh = await c.members(state.pid) // the group may have grown since the page loaded
            const proof = await generateProof(state.identity, new Group(fresh), BigInt(payout), state.pid)
            $("step").dataset.t = "sending", render()
            const res = await fetch(new URL("/relay", relayer), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programId: state.pid.toString(), proof }) })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error === "Underfunded" ? t("underfunded") : body.error === "AlreadyClaimed" ? t("claimed") : body.error)
            show("progress", false), show("pay", false), show("done")
            $("txlink").href = d.explorer ? `${d.explorer}/tx/${body.txHash}` : "#"
            $("txlink").textContent = d.explorer ? t("tx") : body.txHash
            $("bal").textContent = `${ethers.formatUnits(await usdc.balanceOf(payout), dec)} USDC`
            $("to").textContent = `${t("balance")} ${payout}`
        } catch (e) {
            show("progress", false)
            $("error").textContent = `${t("err")}: ${e.message}`
            show("error")
            $("claim").disabled = false
        }
    }
}

main().catch((e) => {
    $("error").textContent = `${t("err")}: ${e.message}`
    show("error")
})

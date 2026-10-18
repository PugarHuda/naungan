// Household claim app. Bundled by `npm run build` into web/claim.js (no CDN for the crypto code).
// The identity secret arrives in the URL fragment from a QR card; fragments are never sent to any
// server, and we strip it from the address bar right away.
import { ethers } from "ethers"
import { Identity, Group, generateProof } from "@semaphore-protocol/core"
import { poseidon2 } from "poseidon-lite"
import QRCode from "qrcode"
import { unlock, unlockV2 } from "../../lib/cardlock.js"

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
        backup: "Write down this backup key and keep it safe. Anyone with it controls the money.", showKey: "Show backup key",
        chance: "Flood chance", chanceOf: (a, b) => `${a}% (claims open at ${b}%)`,
        joinTitle: "Register with your own phone",
        joinHow: "Show this code to the agency staff. It holds no name and cannot be used to claim. Your secret stays only on this phone, so not even the agency can tell when you claim.",
        joinWait: "Not registered yet. Show the code below to the agency, then open this page again.",
        joinBackupBtn: "Show my backup card", joinBackupWarn: "This is your claim card. Print it or keep a photo somewhere safe: if this phone is lost, it is the only way to claim. Anyone holding it can claim for you.",
        claim: "Claim now", proving: "Creating your private proof on this phone…", sending: "Sending through the relayer…",
        done: "Paid", balance: "Paid to", tx: "View transaction", err: "Something went wrong", underfunded: "The program has no funds left right now. Try again later.",
        offline: "No signal. Showing the program as saved on this phone at", queued: "Your claim is ready and saved on this phone. It will be sent automatically when you are back online.",
        privacy: "Your name, ID and location never leave this phone. The blockchain only learns that one enrolled household claimed.",
        wallet: "Wallet on this phone", spend: "Send to a cash-out agent or shop. No fees: you do not need any other coin.",
        to: "Recipient address (0x…)", amt: "Amount in USDC", send: "Send", sent: "Sent", badAmt: "Enter an amount up to your balance",
        pinTitle: "This card is locked. Enter the 6-digit PIN your agency gave you.", unlock: "Unlock card", checking: "Checking PIN…", pinBad: "That PIN does not open this card. Check the slip from your agency.", pinLeft: (n) => `${n} tries left before this card locks.`, pinLocked: "This card is locked after too many wrong PINs. Ask your agency for a new card.", pinOffline: "Checking a PIN needs a connection. Try again when you have signal.",
        alertBtn: "Alert me when claims open", alertOn: "This phone will alert you when claims open, even with the app closed. It remembers your card so the alert opens it.",
        alertNo: "This phone cannot check in the background. Open this page during flood warnings, or listen to your agency.",
        alertDenied: "Notifications are blocked for this site. Allow them in the browser settings to get the alert.",
        alertInstall: "Add Naungan to your home screen first (browser menu → Install app), then tap again."
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
        backup: "Catat kunci cadangan ini dan simpan baik-baik. Siapa pun yang memilikinya menguasai uangnya.", showKey: "Tampilkan kunci cadangan",
        chance: "Peluang banjir", chanceOf: (a, b) => `${a}% (klaim dibuka pada ${b}%)`,
        joinTitle: "Daftar dengan ponsel Anda sendiri",
        joinHow: "Tunjukkan kode ini ke petugas lembaga. Kode ini tidak berisi nama dan tidak bisa dipakai klaim. Rahasia Anda hanya ada di ponsel ini, jadi lembaga pun tidak bisa tahu kapan Anda klaim.",
        joinWait: "Belum terdaftar. Tunjukkan kode di bawah ke lembaga, lalu buka halaman ini lagi.",
        joinBackupBtn: "Tampilkan kartu cadangan saya", joinBackupWarn: "Ini kartu klaim Anda. Cetak atau simpan fotonya di tempat aman: kalau ponsel ini hilang, hanya kartu ini cara untuk klaim. Siapa pun yang memegangnya bisa klaim atas nama Anda.",
        claim: "Klaim sekarang", proving: "Membuat bukti privat di ponsel ini…", sending: "Mengirim lewat relayer…",
        done: "Terbayar", balance: "Dibayar ke", tx: "Lihat transaksi", err: "Terjadi kesalahan", underfunded: "Dana program sedang habis. Coba lagi nanti.",
        offline: "Tidak ada sinyal. Menampilkan data program yang tersimpan di ponsel ini pada", queued: "Klaim Anda sudah siap dan tersimpan di ponsel ini. Akan dikirim otomatis saat sinyal kembali.",
        privacy: "Nama, NIK, dan lokasi Anda tidak pernah keluar dari ponsel ini. Blockchain hanya tahu bahwa satu keluarga terdaftar telah klaim.",
        wallet: "Dompet di ponsel ini", spend: "Kirim ke agen tarik tunai atau toko. Tanpa biaya: Anda tidak perlu koin lain.",
        to: "Alamat penerima (0x…)", amt: "Jumlah USDC", send: "Kirim", sent: "Terkirim", badAmt: "Masukkan jumlah sampai sebesar saldo Anda",
        pinTitle: "Kartu ini terkunci. Masukkan PIN 6 angka dari lembaga bantuan Anda.", unlock: "Buka kartu", checking: "Memeriksa PIN…", pinBad: "PIN tidak cocok untuk kartu ini. Periksa lembar PIN dari lembaga Anda.", pinLeft: (n) => `Sisa ${n} kali percobaan sebelum kartu ini terkunci.`, pinLocked: "Kartu ini terkunci karena terlalu banyak PIN salah. Minta kartu baru ke lembaga Anda.", pinOffline: "Memeriksa PIN butuh koneksi internet. Coba lagi saat ada sinyal.",
        alertBtn: "Beri tahu saya saat klaim dibuka", alertOn: "Ponsel ini akan memberi tahu Anda saat klaim dibuka, meski aplikasi ditutup. Kartu Anda diingat agar notifikasi langsung membukanya.",
        alertNo: "Ponsel ini tidak bisa memeriksa di latar belakang. Buka halaman ini saat ada peringatan banjir, atau ikuti info dari lembaga Anda.",
        alertDenied: "Notifikasi diblokir untuk situs ini. Izinkan di pengaturan browser agar peringatan bisa muncul.",
        alertInstall: "Tambahkan Naungan ke layar utama dulu (menu browser → Instal aplikasi), lalu tekan lagi."
    }
}
let lang = (() => { try { return localStorage.getItem("naungan-lang") } catch { return null } })() || (navigator.language?.startsWith("id") ? "id" : "en")
const t = (k) => T[lang][k]
const locale = () => (lang === "id" ? "id-ID" : "en-GB")
const $ = (id) => document.getElementById(id)
const show = (id, on = true) => $(id).toggleAttribute("hidden", !on)
const scopeHash = (pid) => BigInt(ethers.keccak256(ethers.toBeHex(pid, 32))) >> 8n

const ABI = [
    "function programs(uint256) view returns (address coordinator, uint256 quorum, uint256 groupId, uint256 amountPerHousehold, uint256 triggerThreshold, uint256 claimWindow, uint256 claimDeadline, uint256 lastIndex, uint256 enrolled, uint256 funded, uint256 claims, uint256 seasonEnd)",
    "function metadata(uint256) view returns (string)",
    "function members(uint256) view returns (uint256[])",
    "function nullifierUsed(uint256, uint256) view returns (bool)"
]
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function name() view returns (string)", "function version() view returns (string)"]
const rpc = (d) => new ethers.JsonRpcProvider(d.rpc, d.chainId, { staticNetwork: true })

const state = { pid: null, identity: null }

function readCard(fragment) {
    const q = new URLSearchParams(fragment.replace(/^#/, ""))
    const pid = q.get("p"), id = q.get("id"), v2 = q.get("e2"), locked = v2 ?? q.get("e")
    if (!pid || !(id || locked) || !/^\d+$/.test(pid)) return false
    state.pid = BigInt(pid)
    if (locked) state.locked = locked, state.v2 = v2 != null // PIN-locked card: decrypted on the phone in askPin()
    else state.identity = Identity.import(id) // throws on a corrupted card
    state.card = fragment
    try { sessionStorage.setItem("naungan-card", fragment) } catch {} // a locked card stays encrypted here too
    return locked ? "locked" : true
}

function render() {
    document.documentElement.lang = lang
    document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)))
    $("addr").placeholder = t("addr")
    $("sendTo").placeholder = t("to")
    $("sendAmt").placeholder = t("amt")
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

    // A registration link from the agency (#join=<program>): this phone makes its own identity.
    const joining = location.hash.match(/^#join=(\d{1,20})$/)
    if (joining) return history.replaceState(null, "", location.pathname), join(BigInt(joining[1]))
    // A card saved for flood alerts reopens when the alert is tapped (a PIN-locked one stays encrypted).
    const fragment = location.hash || (() => { try { return sessionStorage.getItem("naungan-card") || localStorage.getItem(SAVED) } catch { return null } })() || ""
    let ok = false
    try { ok = readCard(fragment) } catch { ok = false }
    if (location.hash) history.replaceState(null, "", location.pathname) // keep the secret out of history and screenshots
    if (!ok) {
        const d = await fetch("deployment.json").then((r) => r.json()).catch(() => null)
        // A phone that registered itself reopens straight on its own card.
        const self = d && store.get(SELF(d))
        if (self?.cards?.[self.last] && readCard(self.cards[self.last])) return (state.self = true), load()
        if (d) walletPanel(d).catch(() => {})
        show("nocard")
        $("openCard").onclick = () => {
            const v = $("code").value.trim()
            const frag = v.includes("#") ? v.slice(v.indexOf("#")) : v
            try {
                const r = readCard(frag)
                if (r === "locked") return askPin()
                if (r) return show("nocard", false), load()
            } catch {}
            $("code").setCustomValidity(t("err")), $("code").reportValidity()
        }
        return
    }
    if (ok === "locked") return askPin()
    await load()
}

function askPin() {
    show("nocard", false), show("pinbox")
    $("pin").focus()
    $("pinGo").onclick = async () => {
        const pin = $("pin").value.trim()
        $("pin").setCustomValidity("")
        if (!/^[0-9]{6}$/.test(pin)) return $("pin").setCustomValidity(t("pinBad")), $("pin").reportValidity()
        $("pinGo").disabled = true
        $("pinmsg").className = "note", $("pinmsg").textContent = t("checking")
        let secret, left = null, why = "pinBad"
        try {
            if (!state.v2) secret = await unlock(state.locked, pin, state.pid)
            else {
                // v2: the relayer evaluates a blinded point (it never sees the PIN) and counts tries per card.
                const d = await (await fetch("deployment.json")).json()
                secret = await unlockV2(state.locked, pin, state.pid, async (q) => {
                    let res
                    try {
                        res = await fetch(new URL("/pin", d.relayer ?? "http://localhost:8788"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })
                    } catch {
                        throw Object.assign(new Error("offline"), { why: "pinOffline" })
                    }
                    const body = await res.json().catch(() => ({}))
                    if (res.status === 429 && body.left === 0) throw Object.assign(new Error("locked"), { why: "pinLocked" })
                    if (!res.ok) throw Object.assign(new Error(body.error ?? res.status), { why: "pinOffline" })
                    left = body.left
                    return body.evaluated
                })
            }
        } catch (e) {
            why = e.why ?? why
            $("pinmsg").className = "note bad", $("pinmsg").textContent = t(why) + (why === "pinBad" && left != null ? " " + t("pinLeft")(left) : "")
            $("pinGo").disabled = why === "pinLocked"
            return
        }
        state.identity = Identity.import(secret)
        show("pinbox", false)
        await load().catch((e) => (($("error").textContent = `${t("err")}: ${e.message}`), show("error")))
    }
}

const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
    del: (k) => { try { localStorage.removeItem(k) } catch {} }
}
const PENDING = "naungan-pending"
// Identities this phone made for itself, one per program, never overwritten: { last, cards: { [pid]: card } }.
const SELF = (d) => `naungan-self-${d.naungan}`
const SAVED = "naungan-card-saved"
const ARTIFACT = (depth, ext) => `https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-${depth}.${ext}`
const depthOf = (n) => Math.max(1, Math.ceil(Math.log2(Math.max(n, 2))))

/** Live program state, saved on the phone so the card still works when the signal is gone. */
async function snapshot(d) {
    const key = `naungan-program-${d.naungan}-${state.pid}`
    if (!navigator.onLine && store.get(key)) return { ...store.get(key), offline: true }
    try {
        const provider = rpc(d)
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
    // Only a verdict on the proof itself (400/422) is final; 409/429/5xx mean "try again", so a queued claim is kept.
    if (!res.ok) throw Object.assign(new Error(body.error === "Underfunded" ? t("underfunded") : body.error === "AlreadyClaimed" ? t("claimed") : body.error), { business: res.status === 400 || res.status === 422 })
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
    $("pstatus").textContent = deadline === 0n ? t("watching") : open ? `${t("open_")} ${t("until")} ${new Date(Number(deadline) * 1000).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" })}` : t("closed")
    $("pstatus").className = open ? "pill on" : "pill"
    $("pindex").textContent = t("chanceOf")(snap.lastIndex, snap.threshold)
    if (snap.offline) ($("offline").textContent = `${t("offline")} ${new Date(snap.at).toLocaleString(locale())}`), show("offline")

    const showPaid = (body) => {
        show("progress", false), show("pay", false), show("queued", false), show("done")
        $("txlink").href = d.explorer ? `${d.explorer}/tx/${body.txHash}` : "#"
        $("txlink").textContent = d.explorer ? t("tx") : body.txHash
        $("bal").textContent = `${ethers.formatUnits(amount, snap.dec)} USDC`
        $("to").textContent = `${t("balance")} ${body.payout}`
        if (body.payout === wallet().address) walletPanel(d, (b) => b >= amount)
        // Paid: nothing left to wait for, and the card is spent.
        navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "unwatch", watch: { naungan: d.naungan, pid: state.pid.toString() } }))
        store.del(SAVED), store.del(`naungan-alert-${d.naungan}-${state.pid}`)
    }

    // A proof made while offline waits here and is sent the moment the phone is back online.
    let flushing = false // `online` can fire more than once per reconnect
    const flush = async () => {
        const job = store.get(PENDING)
        if (flushing || !job || job.pid !== state.pid.toString() || !navigator.onLine) return
        flushing = true
        try {
            const body = await relay(relayer, job)
            store.del(PENDING)
            showPaid(body)
        } catch (e) {
            if (e.business) store.del(PENDING), ($("error").textContent = `${t("err")}: ${e.message}`), show("error"), show("queued", false)
        }
        flushing = false
    }
    window.addEventListener("online", flush)
    setInterval(flush, 30e3) // also retry a claim held back by a busy or rate-limited relayer
    if (store.get(PENDING)?.pid === state.pid.toString()) {
        show("queued")
        await flush()
        return
    }

    const enrolled = snap.members.includes(state.identity.commitment.toString())
    const msg = !enrolled ? (state.self ? "joinWait" : "notEnrolled") : snap.claimed ? "claimed" : "enrolled"
    if (!enrolled && state.self) joinPanel()
    $("cardmsg").dataset.t = msg
    $("cardmsg").className = enrolled && !snap.claimed ? "note ok" : "note bad"
    render()
    walletPanel(d)
    if (enrolled && !snap.claimed && deadline === 0n) alertPanel(d, snap)
    if (!enrolled || snap.claimed || !open) return

    show("pay")
    const w = wallet()
    // The backup key only appears on request: it controls the money, and screens get photographed.
    const pickNew = () => {
        $("addr").value = w.address
        $("addr").readOnly = true
        $("backupKey").textContent = ""
        show("backupKey", false), show("showKey")
        $("showKey").onclick = () => (($("backupKey").textContent = w.privateKey), show("backupKey"), show("showKey", false))
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

/**
 * Self-registration: the phone makes the identity, so no agency ever holds the secret that could
 * recognise this household's claim. Re-opening the link reuses the same identity instead of a new one.
 */
async function join(pid) {
    const d = await (await fetch("deployment.json")).json()
    const saved = store.get(SELF(d)) ?? { cards: {} }
    const key = pid.toString()
    const card = saved.cards[key] ?? `p=${pid}&id=${encodeURIComponent(new Identity().export())}`
    store.set(SELF(d), { last: key, cards: { ...saved.cards, [key]: card } })
    if (store.get(SELF(d))?.cards?.[key] !== card) throw new Error("this browser cannot save data, so it cannot keep your registration: use a normal (not private) window")
    readCard(card)
    state.self = true
    await load()
}

/** The code the agency scans into its list, plus a backup card the household can print. */
function joinPanel() {
    show("join")
    const code = `naungan-commitment:${state.pid}:${state.identity.commitment}`
    $("joinCode").textContent = code
    // qrcode renders our own text into SVG markup; nothing from the chain or the user goes in.
    QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((svg) => ($("joinQr").innerHTML = svg))
    $("joinBackupGo").onclick = async () => {
        $("joinBackupQr").innerHTML = await QRCode.toString(`${location.origin}${location.pathname}#${state.card}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
        show("joinBackup"), show("joinBackupGo", false)
    }
}

// Chrome grants background sync only to an installed app: keep its install prompt for the alert button.
let installPrompt
window.addEventListener("beforeinstallprompt", (e) => (e.preventDefault(), (installPrompt = e)))

/** Opt-in flood alert: the service worker polls this program in the background (see sw.js). */
function alertPanel(d, snap) {
    const flag = `naungan-alert-${d.naungan}-${state.pid}`
    const say = (k) => ($("alertmsg").dataset.t = k, render())
    show("alerts")
    if (store.get(flag)) return show("alertGo", false), say("alertOn")
    $("alertGo").onclick = async () => {
        const reg = await navigator.serviceWorker?.ready
        if (!reg || !("periodicSync" in reg) || !("Notification" in window)) return say("alertNo")
        if ((await Notification.requestPermission()) !== "granted") return say("alertDenied")
        const register = () => reg.periodicSync.register("naungan-watch", { minInterval: 6 * 3600e3 }) // the browser may stretch it by engagement
        try {
            await register()
        } catch {
            if (!installPrompt) return say("alertInstall") // no prompt offered (already dismissed, iOS…): explain the menu route
            installPrompt.prompt()
            const { outcome } = await installPrompt.userChoice
            installPrompt = null
            if (outcome !== "accepted") return say("alertInstall")
            try { await register() } catch { return say("alertInstall") }
        }
        reg.active.postMessage({ type: "watch", watch: { rpc: d.rpc, naungan: d.naungan, pid: state.pid.toString(), lang, name: snap.meta.name } })
        try { localStorage.setItem(SAVED, state.card) } catch {}
        store.set(flag, true)
        show("alertGo", false), say("alertOn")
    }
}

/**
 * The payout wallet holds USDC but no ETH. The household signs an EIP-3009 transferWithAuthorization
 * (Circle USDC supports it natively) and the relayer submits it, so cashing out needs no gas token.
 */
async function walletPanel(d, settled = () => true) {
    let key
    try { key = localStorage.getItem("naungan-wallet") } catch {}
    if (!key || !navigator.onLine) return
    const w = new ethers.Wallet(key)
    const token = new ethers.Contract(d.usdc, ERC20, rpc(d))
    let bal = 0n, dec = 6
    // Right after a payment, a load-balanced public RPC can still answer from a node a block behind.
    for (let i = 0; i < 6; i++) {
        ;[bal, dec] = await Promise.all([token.balanceOf(w.address), token.decimals()]).catch(() => [0n, 6])
        if (settled(bal)) break
        await new Promise((r) => setTimeout(r, 2000))
    }
    if (bal === 0n) return show("wallet", false)
    show("wallet")
    $("wbal").textContent = `${ethers.formatUnits(bal, dec)} USDC`
    $("waddr").textContent = w.address
    $("send").onclick = async () => {
        let to, value
        try { to = ethers.getAddress($("sendTo").value.trim()) } catch { return $("sendTo").setCustomValidity(t("to")), $("sendTo").reportValidity() }
        $("sendTo").setCustomValidity("")
        try { value = ethers.parseUnits($("sendAmt").value.trim() || "0", dec) } catch { value = 0n }
        if (value <= 0n || value > bal) return $("sendAmt").setCustomValidity(t("badAmt")), $("sendAmt").reportValidity()
        $("sendAmt").setCustomValidity("")
        $("send").disabled = true
        $("wmsg").textContent = ""
        try {
            const [name, version] = await Promise.all([token.name(), token.version()])
            const now = Math.floor(Date.now() / 1000)
            const msg = { from: w.address, to, value, validAfter: now - 60, validBefore: now + 3600, nonce: ethers.hexlify(ethers.randomBytes(32)) }
            const signature = await w.signTypedData({ name, version, chainId: d.chainId, verifyingContract: d.usdc }, {
                TransferWithAuthorization: [
                    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
                    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
                ]
            }, msg)
            const res = await fetch(new URL("/transfer", d.relayer ?? "http://localhost:8788"), {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...msg, value: value.toString(), signature })
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error)
            $("wmsg").className = "note ok"
            $("wmsg").textContent = `${t("sent")} ${ethers.formatUnits(value, dec)} USDC → ${to}`
            $("sendAmt").value = ""
            await walletPanel(d, (b) => b <= bal - value)
        } catch (e) {
            $("wmsg").className = "note bad"
            $("wmsg").textContent = `${t("err")}: ${e.message}`
        }
        $("send").disabled = false
    }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {})

main().catch((e) => {
    $("error").textContent = `${t("err")}: ${e.message}`
    show("error")
})

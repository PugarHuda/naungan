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
        watching_heat: "Watching the temperature forecast. Claims open automatically when a heatwave is forecast.",
        open__heat: "Heatwave alert: claims are open", chance_heat: "Heatwave chance",
        alertNo_heat: "This phone cannot check in the background. Open this page during heatwave warnings, or listen to your agency.",
        joinClosed_heat: "Registration closed when the heatwave alert opened claims, so this phone cannot join this program now. Ask your agency about the next one.",
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
        scan: "Scan the shop's QR code", scanNo: "This browser cannot scan. Ask the shop to show its address and type or paste it.", scanBad: "That QR code holds no wallet address.", scanDenied: "Camera access was blocked. Allow it in the browser settings, or type the address.",
        fxNote: (d) => `Rupiah value at the ${d} USD rate (exchangerate-api.com); 1 USDC is worth 1 US dollar.`,
        pinTitle: "This card is locked. Enter the 6-digit PIN your agency gave you.", unlock: "Unlock card", checking: "Checking PIN…", pinBad: "That PIN does not open this card. Check the slip from your agency.", pinLeft: (n) => `${n} tries left before this card locks.`, pinLocked: "This card is locked after too many wrong PINs. Ask your agency for a new card.", pinOffline: "Checking a PIN needs a connection. Try again when you have signal.",
        alertBtn: "Alert me when claims open", alertOn: "This phone will alert you when claims open, even with the app closed. It remembers your card so the alert opens it.",
        alertNo: "This phone cannot check in the background. Open this page during flood warnings, or listen to your agency.",
        alertDenied: "Notifications are blocked for this site. Allow them in the browser settings to get the alert.",
        alertInstall: "Add Naungan to your home screen first (browser menu → Install app), then tap again.",
        unknownProgram: "This card is for a program that does not exist on this network. Check that you scanned a Naungan card.",
        notCard: "That is not a Naungan card code. Paste the whole code printed under the QR.", pinFormat: "Enter the 6 digits of your PIN.",
        joinClosed: "Registration closed when the flood alert opened claims, so this phone cannot join this program now. Ask your agency about the next one.",
        another: "Use another card", pickWallet: "Wallet"
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
        watching_heat: "Memantau prakiraan suhu. Klaim terbuka otomatis saat gelombang panas diprakirakan.",
        open__heat: "Peringatan gelombang panas: klaim dibuka", chance_heat: "Peluang gelombang panas",
        alertNo_heat: "Ponsel ini tidak bisa memeriksa di latar belakang. Buka halaman ini saat ada peringatan gelombang panas, atau ikuti info dari lembaga Anda.",
        joinClosed_heat: "Pendaftaran ditutup saat peringatan gelombang panas membuka klaim, jadi ponsel ini tidak bisa ikut program ini sekarang. Tanyakan program berikutnya ke lembaga Anda.",
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
        scan: "Pindai kode QR toko", scanNo: "Browser ini tidak bisa memindai. Minta toko menunjukkan alamatnya lalu ketik atau tempel.", scanBad: "Kode QR itu tidak berisi alamat dompet.", scanDenied: "Akses kamera diblokir. Izinkan di pengaturan browser, atau ketik alamatnya.",
        fxNote: (d) => `Nilai rupiah memakai kurs USD tanggal ${d} (exchangerate-api.com); 1 USDC bernilai 1 dolar AS.`,
        pinTitle: "Kartu ini terkunci. Masukkan PIN 6 angka dari lembaga bantuan Anda.", unlock: "Buka kartu", checking: "Memeriksa PIN…", pinBad: "PIN tidak cocok untuk kartu ini. Periksa lembar PIN dari lembaga Anda.", pinLeft: (n) => `Sisa ${n} kali percobaan sebelum kartu ini terkunci.`, pinLocked: "Kartu ini terkunci karena terlalu banyak PIN salah. Minta kartu baru ke lembaga Anda.", pinOffline: "Memeriksa PIN butuh koneksi internet. Coba lagi saat ada sinyal.",
        alertBtn: "Beri tahu saya saat klaim dibuka", alertOn: "Ponsel ini akan memberi tahu Anda saat klaim dibuka, meski aplikasi ditutup. Kartu Anda diingat agar notifikasi langsung membukanya.",
        alertNo: "Ponsel ini tidak bisa memeriksa di latar belakang. Buka halaman ini saat ada peringatan banjir, atau ikuti info dari lembaga Anda.",
        alertDenied: "Notifikasi diblokir untuk situs ini. Izinkan di pengaturan browser agar peringatan bisa muncul.",
        alertInstall: "Tambahkan Naungan ke layar utama dulu (menu browser → Instal aplikasi), lalu tekan lagi.",
        unknownProgram: "Kartu ini untuk program yang tidak ada di jaringan ini. Pastikan Anda memindai kartu Naungan.",
        notCard: "Itu bukan kode kartu Naungan. Tempel seluruh kode yang tercetak di bawah QR.", pinFormat: "Masukkan 6 angka PIN Anda.",
        joinClosed: "Pendaftaran ditutup saat peringatan banjir membuka klaim, jadi ponsel ini tidak bisa ikut program ini sekarang. Tanyakan program berikutnya ke lembaga Anda.",
        another: "Pakai kartu lain", pickWallet: "Dompet"
    }
}
let lang = (() => { try { return localStorage.getItem("naungan-lang") } catch { return null } })() || (navigator.language?.startsWith("id") ? "id" : "en")
// Hazard-specific wording (a heat program says "heatwave", not "flood") falls back to the shared string.
const t = (k) => (state.hazard === "heat" && T[lang][k + "_heat"]) || T[lang][k]
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

/**
 * A fresh payout wallet per card: two households claiming on one shared phone (or one household in two
 * programs) are paid to unrelated addresses, so the chain cannot link their claims and their money never
 * mixes. Kept as { [naungan:program:commitment]: privateKey }; "naungan-wallet" is the single wallet that
 * earlier versions used for every card, still listed so its balance stays reachable.
 */
const WALLETS = "naungan-wallets"
const cardKey = () => `${state.naungan}:${state.pid}:${state.identity.commitment}`
function wallet() {
    try {
        const all = JSON.parse(localStorage.getItem(WALLETS) ?? "{}")
        if (!all[cardKey()]) {
            all[cardKey()] = ethers.Wallet.createRandom().privateKey
            localStorage.setItem(WALLETS, JSON.stringify(all))
            if (JSON.parse(localStorage.getItem(WALLETS))[cardKey()] !== all[cardKey()]) throw new Error("not saved")
        }
        return new ethers.Wallet(all[cardKey()])
    } catch {
        return (state.ephemeral ??= ethers.Wallet.createRandom()) // storage blocked: still works for this visit
    }
}
/** Every payout wallet this phone holds a key for, newest first. */
function wallets() {
    let keys = []
    try { keys = [...Object.values(JSON.parse(localStorage.getItem(WALLETS) ?? "{}")).reverse(), localStorage.getItem("naungan-wallet")] } catch {}
    return [...new Set(keys.filter(Boolean))].map((k) => new ethers.Wallet(k))
}

/** Any failure while showing a card ends here, in the household's language, never as a silent hang. */
const fail = (e) => {
    show("progress", false)
    $("error").textContent = e?.fatal ? t("unknownProgram") : `${t("err")}: ${e?.message ?? e}`
    show("error")
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
    // "Use another card" (#new): show the empty card form, never a card this phone remembers.
    const fresh = location.hash === "#new"
    if (fresh) try { sessionStorage.removeItem("naungan-card") } catch {}
    // A card saved for flood alerts reopens when the alert is tapped (a PIN-locked one stays encrypted).
    const fragment = location.hash || (() => { try { return sessionStorage.getItem("naungan-card") || localStorage.getItem(SAVED) } catch { return null } })() || ""
    let ok = false
    try { ok = readCard(fragment) } catch { ok = false }
    if (location.hash) history.replaceState(null, "", location.pathname) // keep the secret out of history and screenshots
    if (!ok) {
        const d = await fetch("deployment.json").then((r) => r.json()).catch(() => null)
        // A phone that registered itself reopens straight on its own card.
        const self = !fresh && d && store.get(SELF(d))
        if (self?.cards?.[self.last] && readCard(self.cards[self.last])) return (state.self = true), load()
        if (d) walletPanel(d).catch(() => {})
        show("nocard")
        $("openCard").onclick = () => {
            const v = $("code").value.trim()
            const frag = v.includes("#") ? v.slice(v.indexOf("#")) : v
            let r = false
            try { r = readCard(frag) } catch {}
            if (r === "locked") return askPin()
            if (r) return show("nocard", false), load().catch(fail)
            $("code").setCustomValidity(t("notCard")), $("code").reportValidity()
        }
        $("code").oninput = () => $("code").setCustomValidity("")
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
        if (!/^[0-9]{6}$/.test(pin)) return $("pin").setCustomValidity(t("pinFormat")), $("pin").reportValidity()
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
        await load().catch(fail)
    }
}

const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
    del: (k) => { try { localStorage.removeItem(k) } catch {} }
}
/**
 * What a USDC amount means at the market: the day's USD→IDR rate from a free public API, kept on the
 * phone so it still shows offline. USDC is redeemable 1:1 for US dollars, so USD is the right base.
 */
const FX = "naungan-fx-idr"
async function idrRate() {
    const saved = store.get(FX)
    if (saved && Date.now() - saved.at < 12 * 3600e3) return saved
    try {
        const j = await (await fetch("https://open.er-api.com/v6/latest/USD")).json()
        if (j.result !== "success" || !(j.rates?.IDR > 0)) throw new Error("no rate")
        const fx = { idr: j.rates.IDR, day: j.time_last_update_unix * 1000, at: Date.now() }
        store.set(FX, fx)
        return fx
    } catch {
        return saved // offline or the API is down: the last known rate, or none
    }
}
async function showIdr(id, usdc) {
    const fx = await idrRate()
    if (!fx) return
    $(id).textContent = `≈ Rp ${Math.round(Number(usdc) * fx.idr).toLocaleString("id-ID")}`
    $(id).title = t("fxNote")(new Date(fx.day).toLocaleDateString(locale()))
    show(id)
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
    state.naungan = d.naungan
    const snap = await snapshot(d)
    show("another")
    $("another").onclick = () => (location.hash = "new") // the hashchange listener reloads
    const amount = BigInt(snap.amount), deadline = BigInt(snap.deadline)
    const now = Math.floor(Date.now() / 1000)
    const open = deadline > 0n && now <= Number(deadline)

    $("pname").textContent = snap.meta.name
    if (state.hazard !== snap.meta.hazard) (state.hazard = snap.meta.hazard), render()
    $("pamount").textContent = `${ethers.formatUnits(amount, snap.dec)} USDC`
    showIdr("pidr", ethers.formatUnits(amount, snap.dec))
    $("pstatus").textContent = deadline === 0n ? t("watching") : open ? `${t("open_")} ${t("until")} ${new Date(Number(deadline) * 1000).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" })}` : t("closed")
    $("pstatus").className = open ? "pill on" : "pill"
    $("pindex").textContent = t("chanceOf")(snap.lastIndex, snap.threshold)
    if (snap.offline) ($("offline").textContent = `${t("offline")} ${new Date(snap.at).toLocaleString(locale())}`), show("offline")

    const showPaid = (body) => {
        show("progress", false), show("pay", false), show("queued", false), show("done")
        $("txlink").href = d.explorer ? `${d.explorer}/tx/${body.txHash}` : "#"
        $("txlink").textContent = d.explorer ? t("tx") : body.txHash
        $("bal").textContent = `${ethers.formatUnits(amount, snap.dec)} USDC`
        showIdr("balIdr", ethers.formatUnits(amount, snap.dec))
        $("to").textContent = `${t("balance")} ${body.payout}`
        $("cardmsg").dataset.t = "claimed", ($("cardmsg").className = "note ok"), render()
        walletPanel(d, (b) => b >= amount, body.payout)
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
    // Enrollment freezes when the trigger fires (the contract reverts AlreadyTriggered): say so instead of sending them to the agency.
    const msg = !enrolled ? (state.self ? (deadline > 0n ? "joinClosed" : "joinWait") : "notEnrolled") : snap.claimed ? "claimed" : "enrolled"
    if (!enrolled && state.self && deadline === 0n) joinPanel()
    $("cardmsg").dataset.t = msg
    $("cardmsg").className = enrolled && !snap.claimed ? "note ok" : "note bad"
    render()
    walletPanel(d, undefined, enrolled ? wallet().address : undefined)
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
            if (e.fatal) return fail(e)
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
    await load().catch(fail)
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

/** Opt-in hazard alert: the service worker polls this program in the background (see sw.js). */
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
        reg.active.postMessage({ type: "watch", watch: { rpc: d.rpc, naungan: d.naungan, pid: state.pid.toString(), lang, name: snap.meta.name, hazard: snap.meta.hazard } })
        try { localStorage.setItem(SAVED, state.card) } catch {}
        store.set(flag, true)
        show("alertGo", false), say("alertOn")
    }
}

/**
 * The payout wallet holds USDC but no ETH. The household signs an EIP-3009 transferWithAuthorization
 * (Circle USDC supports it natively) and the relayer submits it, so cashing out needs no gas token.
 */
async function walletPanel(d, settled = () => true, prefer) {
    const all = wallets()
    if (!all.length || !navigator.onLine) return
    const token = new ethers.Contract(d.usdc, ERC20, rpc(d))
    const dec = await token.decimals().catch(() => 6n)
    const read = (a) => token.balanceOf(a).catch(() => 0n)
    const bals = new Map(await Promise.all(all.map(async (x) => [x.address, await read(x.address)])))
    // Right after a payment, a load-balanced public RPC can still answer from a node a block behind.
    for (let i = 0; prefer && bals.has(prefer) && i < 6 && !settled(bals.get(prefer)); i++) {
        await new Promise((r) => setTimeout(r, 2000))
        bals.set(prefer, await read(prefer))
    }
    const funded = all.filter((x) => bals.get(x.address) > 0n).sort((a, b) => (b.address === prefer) - (a.address === prefer))
    if (!funded.length) return show("wallet", false)
    show("wallet")
    // One phone can hold several households' wallets: pick which one to spend from, never a merged total.
    const pick = $("wpick")
    pick.replaceChildren(...funded.map((x) => new Option(`${x.address.slice(0, 8)}…${x.address.slice(-4)} · ${ethers.formatUnits(bals.get(x.address), dec)} USDC`, x.address)))
    show("wpickBox", funded.length > 1)
    const use = (addr) => {
        const w = funded.find((x) => x.address === addr), bal = bals.get(addr)
        $("wbal").textContent = `${ethers.formatUnits(bal, dec)} USDC`
        showIdr("wIdr", ethers.formatUnits(bal, dec))
        $("waddr").textContent = w.address
        spendFrom(d, token, w, bal, dec)
    }
    pick.onchange = () => use(pick.value)
    use(funded[0].address)
}

function spendFrom(d, token, w, bal, dec) {
    $("scanGo").onclick = () => scanAddress($("sendTo"), $("wmsg"))
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
            await walletPanel(d, (b) => b <= bal - value, w.address)
        } catch (e) {
            $("wmsg").className = "note bad"
            $("wmsg").textContent = `${t("err")}: ${e.message}`
        }
        $("send").disabled = false
    }
}

/**
 * Paying a shop or cash-out agent: point the camera at the QR its wallet app shows. Uses the browser's
 * own BarcodeDetector (Chrome on Android); plain addresses and EIP-681 "ethereum:0x…" links both work.
 */
async function scanAddress(input, msg) {
    const say = (k) => ((msg.className = "note bad"), (msg.textContent = t(k)))
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return say("scanNo")
    let stream
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    } catch {
        return say("scanDenied")
    }
    const video = $("scanVideo")
    video.srcObject = stream
    show("scanBox")
    await video.play()
    const detector = new BarcodeDetector({ formats: ["qr_code"] })
    const stop = () => (stream.getTracks().forEach((x) => x.stop()), show("scanBox", false))
    $("scanStop").onclick = stop
    for (let i = 0; i < 300 && stream.active; i++) { // about a minute, then give up quietly
        const [code] = await detector.detect(video).catch(() => [])
        if (code) {
            stop()
            const addr = code.rawValue.match(/0x[0-9a-fA-F]{40}/)?.[0]
            if (!addr) return say("scanBad")
            input.value = ethers.getAddress(addr.toLowerCase())
            msg.textContent = ""
            return $("sendAmt").focus()
        }
        await new Promise((r) => setTimeout(r, 200))
    }
    stop()
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {})

main().catch((e) => {
    $("error").textContent = `${t("err")}: ${e.message}`
    show("error")
})

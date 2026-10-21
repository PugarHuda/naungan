// The claim flow: read the card, show the program, prove and send the claim, keep it queued when offline.
// Components call into this module and render `ui`. The identity secret arrives in the URL fragment from
// a QR card; fragments are never sent to any server, and we strip it from the address bar right away.
import { ethers } from "ethers"
// Only what reading a card needs loads up front. The identity package is small; proving (snarkjs, about
// 480 KB) loads when a claim becomes possible, and the PIN code only for a locked card. The service worker
// precaches those chunks too (vite.config.mjs), so a phone that opened the app once can still prove offline.
import { Identity } from "@semaphore-protocol/identity"
import { poseidon2 } from "poseidon-lite/poseidon2" // the package root bundles every arity's constants (~530 KB)
const proving = () => Promise.all([import("@semaphore-protocol/proof"), import("@semaphore-protocol/group")])
import { deployment as d, naungan, provider, parseMeta, ERC20_ABI } from "../shared/chain"
import { placeOf, usdRates } from "../shared/place"
import { ui, card, store, t, type Snapshot } from "./state.svelte"
import { encode, feedbackScope } from "../../../lib/feedback.mjs"

export const RELAYER = d.relayer ?? "http://localhost:8788"
const PENDING = "naungan-pending"
// Identities this phone made for itself, one per program, never overwritten: { last, cards: { [pid]: card } }.
export const SELF = `naungan-self-${d.naungan}`
export const SAVED = "naungan-card-saved"
const ARTIFACT = (depth: number, ext: string) => `https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-${depth}.${ext}`
const depthOf = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(n, 2))))
const scopeHash = (pid: bigint) => BigInt(ethers.keccak256(ethers.toBeHex(pid, 32))) >> 8n

/** Reads a card fragment (`p=…&id=…`, or PIN-locked `e=` / `e2=`): false if it is not one, "locked" if it needs its PIN. */
export function readCard(fragment: string): boolean | "locked" {
    const q = new URLSearchParams(fragment.replace(/^#/, ""))
    const pid = q.get("p"), id = q.get("id"), v2 = q.get("e2"), locked = v2 ?? q.get("e")
    if (!pid || !(id || locked) || !/^\d+$/.test(pid)) return false
    card.pid = BigInt(pid)
    if (locked) (card.locked = locked), (card.v2 = v2 != null) // PIN-locked card: decrypted on the phone in tryPin()
    else card.identity = Identity.import(id!) // throws on a corrupted card
    card.fragment = fragment
    try { sessionStorage.setItem("naungan-card", fragment) } catch {} // a locked card stays encrypted here too
    return locked ? "locked" : true
}

/**
 * A fresh payout wallet per card: two households claiming on one shared phone (or one household in two
 * programs) are paid to unrelated addresses, so the chain cannot link their claims and their money never
 * mixes. Kept as { [naungan:program:commitment]: privateKey }; "naungan-wallet" is the single wallet that
 * earlier versions used for every card, still listed so its balance stays reachable.
 */
const WALLETS = "naungan-wallets"
const cardKey = () => `${card.naungan}:${card.pid}:${card.identity!.commitment}`
export function wallet() {
    try {
        const all = JSON.parse(localStorage.getItem(WALLETS) ?? "{}")
        if (!all[cardKey()]) {
            all[cardKey()] = ethers.Wallet.createRandom().privateKey
            localStorage.setItem(WALLETS, JSON.stringify(all))
            if (JSON.parse(localStorage.getItem(WALLETS)!)[cardKey()] !== all[cardKey()]) throw new Error("not saved")
        }
        return new ethers.Wallet(all[cardKey()])
    } catch {
        return (card.ephemeral ??= ethers.Wallet.createRandom()) // storage blocked: still works for this visit
    }
}
/** Every payout wallet this phone holds a key for, newest first. */
function wallets() {
    let keys: (string | null)[] = []
    try { keys = [...(Object.values(JSON.parse(localStorage.getItem(WALLETS) ?? "{}")) as string[]).reverse(), localStorage.getItem("naungan-wallet")] } catch {}
    return [...new Set(keys.filter(Boolean) as string[])].map((k) => new ethers.Wallet(k))
}

/** Any failure while showing a card ends here, in the household's language, never as a silent hang. */
export const fail = (e: any) => {
    ui.step = null
    ui.error = e?.fatal ? t("unknownProgram") : `${t("err")}: ${e?.message ?? e}`
}

/** Start: a registration link, a card in the fragment, a remembered card, or the empty card form. */
export async function start() {
    // A registration link from the agency (#join=<program>): this phone makes its own identity.
    const joining = location.hash.match(/^#join=(\d{1,20})$/)
    if (joining) return history.replaceState(null, "", location.pathname), join(BigInt(joining[1]))
    // "Use another card" (#new): show the empty card form, never a card this phone remembers.
    const fresh = location.hash === "#new"
    if (fresh) try { sessionStorage.removeItem("naungan-card") } catch {}
    // A card saved for flood alerts reopens when the alert is tapped (a PIN-locked one stays encrypted).
    const fragment = location.hash || (() => { try { return sessionStorage.getItem("naungan-card") || localStorage.getItem(SAVED) } catch { return null } })() || ""
    let ok: boolean | "locked" = false
    try { ok = readCard(fragment) } catch { ok = false }
    if (location.hash) history.replaceState(null, "", location.pathname) // keep the secret out of history and screenshots
    if (!ok) {
        // A phone that registered itself reopens straight on its own card.
        const self = !fresh && store.get(SELF)
        if (self?.cards?.[self.last] && readCard(self.cards[self.last])) return (card.self = true), load()
        walletPanel().catch(() => {})
        ui.nocard = true
        return
    }
    if (ok === "locked") return (ui.pin = true)
    // A card this phone made for itself (reopened from the tab or an alert) still shows its registration code.
    card.self = Object.values(store.get(SELF)?.cards ?? {}).includes(card.fragment)
    await load()
}

/** The pasted card code: "notCard" if it is not one, otherwise the card opens (or asks for its PIN). */
export function openCard(v: string): "notCard" | null {
    const frag = v.includes("#") ? v.slice(v.indexOf("#")) : v
    let r: boolean | "locked" = false
    try { r = readCard(frag) } catch {}
    if (r === "locked") return (ui.nocard = false), (ui.pin = true), null
    if (r) return (ui.nocard = false), load().catch(fail), null
    return "notCard"
}

/** Decrypt a PIN-locked card on the phone. Returns null on success, else the message key and tries left. */
export async function tryPin(pin: string): Promise<{ why: string; left: number | null } | null> {
    let secret: string, left: number | null = null
    try {
        const { unlock, unlockV2 } = await import("../../../lib/cardlock.mjs")
        if (!card.v2) secret = await unlock(card.locked, pin, card.pid)
        else {
            // v2: the relayer evaluates a blinded point (it never sees the PIN) and counts tries per card.
            secret = await unlockV2(card.locked, pin, card.pid, async (q: unknown) => {
                let res
                try {
                    res = await fetch(new URL("/pin", RELAYER), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })
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
    } catch (e: any) {
        return { why: e.why ?? "pinBad", left }
    }
    card.identity = Identity.import(secret)
    ui.pin = false
    load().catch(fail)
    return null
}

/** Live program state, saved on the phone so the card still works when the signal is gone. */
async function snapshot(): Promise<Snapshot> {
    const key = `naungan-program-${d.naungan}-${card.pid}`
    if (!navigator.onLine && store.get(key)) return { ...store.get(key), offline: true }
    try {
        const p = provider()
        const c = naungan(p)
        const usdc = new ethers.Contract(d.usdc, ERC20_ABI, p)
        const nullifier = poseidon2([scopeHash(card.pid!), card.identity!.secretScalar])
        const [prog, metaRaw, members, dec, claimed] = await Promise.all([c.programs(card.pid), c.metadata(card.pid), c.members(card.pid), usdc.decimals(), c.nullifierUsed(card.pid, nullifier)])
        if (!metaRaw) throw Object.assign(new Error("unknown program"), { fatal: true })
        const snap: Snapshot = {
            amount: prog.amountPerHousehold.toString(), threshold: prog.triggerThreshold.toString(), lastIndex: prog.lastIndex.toString(),
            deadline: prog.claimDeadline.toString(), meta: parseMeta(metaRaw), members: members.map(String), dec: Number(dec), claimed, at: Date.now()
        }
        store.set(key, snap)
        // While there is signal, have the service worker keep the proving keys this group needs (and the next size up).
        const depth = depthOf(members.length)
        navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "prefetch", urls: [depth, depth + 1].flatMap((x) => [ARTIFACT(x, "wasm"), ARTIFACT(x, "zkey")]) }))
        return { ...snap, offline: false }
    } catch (e: any) {
        const cached = store.get(key)
        if (e.fatal || !cached) throw e
        return { ...cached, offline: true }
    }
}

type Job = { pid: string; proof: unknown; payout: string }
async function relay(job: Job) {
    const res = await fetch(new URL("/relay", RELAYER), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programId: job.pid, proof: job.proof }) })
    const body = await res.json()
    // Only a verdict on the proof itself (400/422) is final; 409/429/5xx mean "try again", so a queued claim is kept.
    if (!res.ok) throw Object.assign(new Error(body.error === "Underfunded" ? t("underfunded") : body.error === "AlreadyClaimed" ? t("claimed") : body.error), { business: res.status === 400 || res.status === 422 })
    return body
}

/** Which country the program runs in (`country` in newer metadata, else from its on-chain coordinates), for local money. */
async function place(meta: Snapshot["meta"]) {
    const old = store.get(`naungan-place:${d.naungan}:${card.pid}`) // the key versions before the Svelte port kept
    const cc = meta.country ?? (typeof old === "string" ? old : null) ?? (Number.isFinite(meta.lat) ? (await placeOf(meta.lat!, meta.lon!))?.code : null)
    if (!cc) return // offline: amounts stay in USDC until the next visit
    ui.country = cc
}

function showPaid(body: { txHash: string; payout: string }, amount: bigint, dec: number) {
    ui.step = null
    ui.pay = null
    ui.queued = false
    unqueue() // sent from the page: the service worker has nothing left to send
    ui.paid = { txHash: body.txHash, payout: body.payout, amount: ethers.formatUnits(amount, dec) }
    ui.cardMsg = { key: "claimed", ok: true }
    walletPanel((b) => b >= amount, body.payout)
    // Paid: nothing left to wait for, and the card is spent.
    navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "unwatch", watch: { naungan: d.naungan, pid: card.pid!.toString() } }))
    store.del(SAVED), store.del(`naungan-alert-${d.naungan}-${card.pid}`)
}

/** Hands a queued claim to the service worker's Background Sync (Chromium), which sends it with the app closed. */
async function queueInBackground(job: Job, amount: string) {
    const r: any = await navigator.serviceWorker?.ready
    if (!r?.sync) return // other browsers: the page sends it the next time it is open with signal
    const note = { title: t("done"), body: t("readPaid")(amount) } // written now, in the household's language
    await (await caches.open("naungan-send")).put("/__claim__", new Response(JSON.stringify({ relay: new URL("/relay", RELAYER).href, job, note })))
    await r.sync.register("naungan-claim")
}
const unqueue = () => globalThis.caches?.open("naungan-send").then((c) => c.delete("/__claim__")).catch(() => {})

let flushTimer: ReturnType<typeof setInterval> | undefined
async function load() {
    ui.program = true
    card.naungan = d.naungan
    const snap = await snapshot()
    ui.hazard = snap.meta.hazard
    ui.snap = snap
    ui.another = true
    usdRates().then((fx) => (ui.fx = fx))
    await place(snap.meta)
    const amount = BigInt(snap.amount), deadline = BigInt(snap.deadline)
    const open = deadline > 0n && Date.now() / 1000 <= Number(deadline)

    // A proof made while offline waits here and is sent the moment the phone is back online.
    let flushing = false // `online` can fire more than once per reconnect
    const flush = async () => {
        const job: Job | null = store.get(PENDING)
        if (flushing || !job || job.pid !== card.pid!.toString() || !navigator.onLine) return
        flushing = true
        try {
            const body = await relay(job)
            store.del(PENDING)
            showPaid(body, amount, snap.dec)
        } catch (e: any) {
            if (e.business) store.del(PENDING), unqueue(), (ui.error = `${t("err")}: ${e.message}`), (ui.queued = false)
        }
        flushing = false
    }
    window.addEventListener("online", flush)
    clearInterval(flushTimer)
    flushTimer = setInterval(flush, 30e3) // also retry a claim held back by a busy or rate-limited relayer
    if (store.get(PENDING)?.pid === card.pid!.toString()) {
        ui.queued = true
        await flush()
        return
    }

    const enrolled = snap.members.includes(card.identity!.commitment.toString())
    // Enrollment freezes when the trigger fires (the contract reverts AlreadyTriggered): say so instead of sending them to the agency.
    const msg = !enrolled ? (card.self ? (deadline > 0n ? "joinClosed" : "joinWait") : "notEnrolled") : snap.claimed ? "claimed" : "enrolled"
    if (!enrolled && card.self && deadline === 0n) ui.join = { code: `naungan-commitment:${card.pid}:${card.identity!.commitment}`, card: card.fragment }
    ui.cardMsg = { key: msg, ok: enrolled && !snap.claimed }
    walletPanel(undefined, enrolled ? wallet().address : undefined)
    if (enrolled && !snap.claimed && deadline === 0n) ui.alerts = true
    if (enrolled && !snap.offline) ui.feedback = true
    if (!enrolled || snap.claimed || !open) return
    ui.pay = { wallet: wallet() }
    proving().catch(() => {}) // warm the prover while the household chooses where the money goes

    claimHandler = async (payout: string) => {
        ui.error = ""
        ui.step = "proving"
        let job: Job | undefined
        try {
            // Re-read the group when online (it may have grown); offline, the saved group is still valid
            // because enrollment freezes when the trigger fires.
            const members = navigator.onLine ? (await snapshot()).members : snap.members
            const [{ generateProof }, { Group }] = await proving()
            const proof = await generateProof(card.identity!, new Group(members.map(BigInt)), BigInt(payout), card.pid!)
            job = { pid: card.pid!.toString(), proof, payout }
            ui.step = "sending"
            showPaid(await relay(job), amount, snap.dec)
            return true
        } catch (e: any) {
            if (e.fatal) return fail(e), false
            ui.step = null
            if (job && !e.business) {
                store.set(PENDING, job) // no signal: keep the proof, send it automatically later
                queueInBackground(job, ethers.formatUnits(amount, snap.dec)).catch(() => {})
                ui.pay = null
                ui.queued = true
                return true
            }
            ui.error = `${t("err")}: ${e.message}`
            return false
        }
    }
}
let claimHandler: ((payout: string) => Promise<boolean | undefined>) | null = null

const ratedKey = () => `naungan-rated-${d.naungan}-${card.pid}-${card.identity?.commitment}`
/** This card's sent rating on this phone: its transaction, "already" (sent before, from anywhere), or null. */
export const ratedTx = (): string | null => store.get(ratedKey())
/**
 * The household's anonymous rating (lib/feedback.mjs), proved on this phone against the current group (Semaphore
 * accepts a superseded root for an hour only) and sent through the relayer to Semaphore's validateProof.
 */
export async function sendFeedback(rating: number, topic: number): Promise<string> {
    const members = (await snapshot()).members
    const [{ generateProof }, { Group }] = await proving()
    const proof = await generateProof(card.identity!, new Group(members.map(BigInt)), encode(rating, topic), feedbackScope(d.naungan, card.pid!))
    const res = await fetch(new URL("/feedback", RELAYER), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programId: card.pid!.toString(), proof }) })
    const body = await res.json()
    if (!res.ok && body.error !== "AlreadyRated") throw new Error(body.error ?? `HTTP ${res.status}`)
    const done = res.ok ? body.txHash : "already"
    store.set(ratedKey(), done)
    return done
}
/** Prove and send the claim to `payout`; false means the button may be pressed again. */
export const claim = (payout: string) => claimHandler!(payout)

/**
 * Self-registration: the phone makes the identity, so no agency ever holds the secret that could
 * recognise this household's claim. Re-opening the link reuses the same identity instead of a new one.
 */
async function join(pid: bigint) {
    const saved = store.get(SELF) ?? { cards: {} }
    const key = pid.toString()
    const c = saved.cards[key] ?? `p=${pid}&id=${encodeURIComponent(new Identity().export())}`
    store.set(SELF, { last: key, cards: { ...saved.cards, [key]: c } })
    if (store.get(SELF)?.cards?.[key] !== c) throw new Error("this browser cannot save data, so it cannot keep your registration: use a normal (not private) window")
    readCard(c)
    card.self = true
    await load().catch(fail)
}

export const usdc = () => new ethers.Contract(d.usdc, ERC20_ABI, provider())

/**
 * Wallets on this phone that hold USDC. The payout wallet holds USDC but no ETH: spending goes through
 * EIP-3009 and the relayer (see Wallet.svelte). `settled` waits out an RPC node a block behind for `prefer`.
 */
export async function walletPanel(settled: (b: bigint) => boolean = () => true, prefer?: string) {
    const all = wallets()
    if (!all.length || !navigator.onLine) return
    const token = usdc()
    const dec: bigint = await token.decimals().catch(() => 6n)
    const read = (a: string): Promise<bigint> => token.balanceOf(a).catch(() => 0n)
    const bals = new Map(await Promise.all(all.map(async (x) => [x.address, await read(x.address)] as const)))
    // Right after a payment, a load-balanced public RPC can still answer from a node a block behind.
    for (let i = 0; prefer && bals.has(prefer) && i < 6 && !settled(bals.get(prefer)!); i++) {
        await new Promise((r) => setTimeout(r, 2000))
        bals.set(prefer, await read(prefer))
    }
    const funded = all
        .filter((x) => bals.get(x.address)! > 0n)
        .sort((a, b) => Number(b.address === prefer) - Number(a.address === prefer))
        .map((w) => ({ wallet: w, bal: bals.get(w.address)! }))
    ui.wallets = funded.length ? { funded, dec, prefer } : null
}

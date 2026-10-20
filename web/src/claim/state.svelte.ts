// The claim app's state. `ui` is reactive (components render from it); `card` holds the card being shown
// and its secret, which never needs to re-render anything and so stays a plain object.
import type { Identity } from "@semaphore-protocol/core"
import type { Wallet, HDNodeWallet } from "ethers"
import type { ProgramMeta } from "../shared/chain"
import type { Rates } from "../shared/place"
import { T } from "./i18n"

/** Program state saved on the phone so the card still works when the signal is gone (same shape as before the port). */
export type Snapshot = {
    amount: string
    threshold: string
    lastIndex: string
    deadline: string
    meta: ProgramMeta
    members: string[]
    dec: number
    claimed: boolean
    at: number
    offline?: boolean
}
export type Funded = { wallet: Wallet; bal: bigint }

const savedLang = (() => { try { return localStorage.getItem("naungan-lang") } catch { return null } })()
export const chosenLang = savedLang && T[savedLang] ? savedLang : null
export const phoneLang = navigator.languages?.map((l) => l.slice(0, 2)).find((l) => T[l] && l !== "en") ?? null

export const ui = $state({
    // Language: the household's own choice, else the phone's language if we have it, else (once the program's
    // country is known) that country's main language, else English.
    lang: chosenLang ?? phoneLang ?? "en",
    hazard: undefined as string | undefined,
    country: undefined as string | undefined,
    fx: null as Rates | null,
    error: "",
    nocard: false,
    pin: false,
    program: false, // the program card, shown with placeholders while the snapshot loads
    snap: null as Snapshot | null,
    another: false,
    cardMsg: null as { key: string; ok: boolean } | null,
    alerts: false,
    join: null as { code: string; card: string } | null,
    pay: null as { wallet: Wallet | HDNodeWallet } | null,
    queued: false,
    step: null as string | null,
    paid: null as { txHash: string; payout: string; amount: string } | null,
    wallets: null as { funded: Funded[]; dec: bigint; prefer?: string } | null
})

/** The card on screen. `identity` is set once the card is read (or its PIN unlocks it). */
export const card = {
    pid: null as bigint | null,
    identity: null as Identity | null,
    locked: null as string | null,
    v2: false,
    fragment: "",
    self: false,
    naungan: "",
    ephemeral: null as HDNodeWallet | null
}

// Hazard-specific wording (a heat program says "heatwave", not "flood") falls back to the shared string.
export function t(k: string): any {
    return (ui.hazard === "heat" && T[ui.lang][k + "_heat"]) || T[ui.lang][k]
}
export const locale = () => (ui.country ? `${ui.lang}-${ui.country}` : ui.lang === "en" ? "en-GB" : ui.lang)

export const store = {
    get: (k: string): any => { try { return JSON.parse(localStorage.getItem(k) ?? "null") } catch { return null } },
    set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
    del: (k: string) => { try { localStorage.removeItem(k) } catch {} }
}

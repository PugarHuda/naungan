// Formatting and wording shared by the dashboard panels.
import { toBeHex } from "ethers"
import { deployment as d, type ProgramMeta } from "../shared/chain"

/** One chain event, as ethers' EventLog or our indexer rows (lib/chain.js indexed()) shape it. */
export type Ev = {
    args: any
    fragment: { name: string; inputs: readonly { name: string }[] }
    blockNumber: number
    index: number
    transactionHash: string
}

/** A status message: plain text, with optional links (chain data never becomes HTML). */
export type Part = string | { href: string; label: string }

export const usd = (v: bigint | number) => (Number(v) / 1e6).toLocaleString("en", { maximumFractionDigits: 2 })
// Hashes and addresses here keep 8 leading characters: more of a tx hash is recognisable at a glance.
export const short = (h: string) => h.slice(0, 8) + "…" + h.slice(-4)
export const day = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
export const until = (t: bigint) => new Date(Number(t) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
export const netName = d.network === "baseSepolia" ? "Base Sepolia" : d.network
export const txUrl = (hash: string) => (d.explorer ? `${d.explorer}/tx/${hash}` : undefined)

/** Words that change with the hazard a program insures against. */
export const words = (m?: ProgramMeta) => (m?.hazard === "heat" ? { noun: "heatwave", Noun: "Heatwave" } : { noun: "flood", Noun: "Flood" })

export function describe(e: Ev, metas: Record<string, ProgramMeta>): [string, string] {
    const a = e.args
    switch (e.fragment.name) {
        case "AgencyAdded": return ["Agency joined the program", short(a.agency)]
        case "AgencyRemoved": return ["Agency removed by the coordinator", short(a.agency)]
        case "Enrolled": return [`${a.households} households enrolled anonymously`, `agency ${short(a.agency)}, commitments only`]
        case "Funded": return [`${usd(a.amount)} USDC added to the pool`, `donor ${short(a.donor)}`]
        case "IndexReported": return [`Oracle reported ${a.value}% ${words(metas[String(a.programId)]).noun} probability${a.triggered ? ": trigger reached, claims open" : ""}`, a.evidence]
        case "Claimed": return ["A household was paid", `nullifier ${short(toBeHex(a.nullifier))} to ${short(a.payout)}`]
        case "Refunded": return [`${usd(a.amount)} USDC returned to a donor`, `their pro-rata share of what was not paid out, to ${short(a.donor)}`]
    }
    return [e.fragment.name, ""]
}

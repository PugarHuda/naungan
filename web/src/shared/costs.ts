// What running a program costs in gas, measured from its real transactions on Base Sepolia and priced on Base
// mainnet today: mainnet's own gas price (eth_gasPrice), the L1 data fee its GasPriceOracle predeploy charges for the
// same transaction bytes, and ETH/USD from Chainlink's feed on Base. No fee or price is typed in by hand.
import { Contract, JsonRpcProvider, Transaction, type Provider } from "ethers"

export const BASE_MAINNET = "https://mainnet.base.org"
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" // OP Stack predeploy, same address on every OP chain
const CHAINLINK_ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" // Chainlink ETH / USD on Base mainnet
/** Each oracle key reports about every 6 hours (.github/workflows/oracle.yml with `--every 5.5`). */
export const REPORTS_PER_KEY_PER_YEAR = 4 * 365

export type Kind = "claim" | "report" | "enroll" | "fund"
export type Sample = { kind: Kind; hash: string; households?: number }
/** Measured per action: gas used (per household for enrolment), and the mainnet L1 data fee of the same bytes, in wei. */
export type Measured = Record<Kind, { gas: bigint; l1: bigint; n: number } | undefined>
export type Prices = { gasPrice: bigint; ethUsd: number; at: number }

/** Mainnet cost of one action in USD. */
export const usdOf = (m: { gas: bigint; l1: bigint }, p: Prices) => (Number(m.gas * p.gasPrice + m.l1) / 1e18) * p.ethUsd

/** One program for a season: its oracle reports for a year, and one enrolment and one claim per enrolled household. */
export function season(m: Measured, p: Prices, oracles: number, households: number, perHouseholdUsd: number) {
    const per = (k: Kind) => (m[k] ? usdOf(m[k]!, p) : 0)
    const reports = oracles * REPORTS_PER_KEY_PER_YEAR * per("report")
    const delivery = households * (per("enroll") + per("claim"))
    const total = reports + delivery
    const paid = households * perHouseholdUsd
    return { reports, delivery, total, perHousehold: households ? total / households : 0, share: paid ? total / paid : 0 }
}

/** Average gas per action from its receipts, and the L1 fee Base mainnet would charge for one of them. */
export async function measure(samples: Sample[], testnet: Provider, mainnet: Provider = new JsonRpcProvider(BASE_MAINNET, 8453, { staticNetwork: true })): Promise<Measured> {
    const gpo = new Contract(GAS_PRICE_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], mainnet)
    const out: Measured = { claim: undefined, report: undefined, enroll: undefined, fund: undefined }
    for (const kind of ["claim", "report", "enroll", "fund"] as Kind[]) {
        const mine = samples.filter((s) => s.kind === kind).slice(-3) // the latest three: costs change with the contract, not with history
        if (!mine.length) continue
        let gas = 0n, units = 0
        for (const s of mine) {
            const r = await testnet.getTransactionReceipt(s.hash)
            if (!r) throw new Error(`no receipt for ${s.hash}`)
            gas += r.gasUsed
            units += kind === "enroll" ? Math.max(1, s.households ?? 1) : 1
        }
        const tx = await testnet.getTransaction(mine.at(-1)!.hash)
        if (!tx) throw new Error(`no transaction ${mine.at(-1)!.hash}`)
        const l1: bigint = await gpo.getL1Fee(Transaction.from(tx).serialized)
        const per = kind === "enroll" ? Math.max(1, mine.at(-1)!.households ?? 1) : 1
        out[kind] = { gas: gas / BigInt(units), l1: l1 / BigInt(per), n: mine.length }
    }
    return out
}

export async function prices(mainnet: Provider = new JsonRpcProvider(BASE_MAINNET, 8453, { staticNetwork: true })): Promise<Prices> {
    const feed = new Contract(CHAINLINK_ETH_USD, ["function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)", "function decimals() view returns (uint8)"], mainnet)
    const [fee, round, dec] = await Promise.all([mainnet.getFeeData(), feed.latestRoundData(), feed.decimals()])
    if (fee.gasPrice === null) throw new Error("Base mainnet gave no gas price")
    return { gasPrice: fee.gasPrice, ethUsd: Number(round.answer) / 10 ** Number(dec), at: Number(round.updatedAt) }
}

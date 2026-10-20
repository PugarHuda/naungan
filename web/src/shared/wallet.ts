// Donations and audit signatures from any EIP-1193 wallet. EIP-6963 lists every installed wallet (MetaMask,
// Coinbase, Rabby…) without them fighting over window.ethereum; the first one announced is used, window.ethereum otherwise.
import { BrowserProvider, type Eip1193Provider } from "ethers"
import { deployment as d } from "./chain"

type Announced = { info: { name: string }; provider: Eip1193Provider }
const wallets: Announced[] = []
if (typeof window !== "undefined") {
    window.addEventListener("eip6963:announceProvider", (e) => wallets.push((e as CustomEvent<Announced>).detail))
    window.dispatchEvent(new Event("eip6963:requestProvider"))
}

export const browserWallet = (): Eip1193Provider | undefined => wallets[0]?.provider ?? (window as { ethereum?: Eip1193Provider }).ethereum

/** The visitor's wallet on this deployment's chain (added to the wallet if it does not know it yet). */
export async function walletSigner(eth: Eip1193Provider) {
    await eth.request({ method: "eth_requestAccounts" })
    const hex = "0x" + d.chainId.toString(16)
    if ((await eth.request({ method: "eth_chainId" })) !== hex) {
        try {
            await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] })
        } catch (e) {
            if ((e as { code?: number }).code !== 4902) throw e // 4902: the wallet does not know this chain yet
            await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: d.network === "baseSepolia" ? "Base Sepolia" : d.network, rpcUrls: [d.rpc], blockExplorerUrls: d.explorer ? [d.explorer] : [], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }] })
        }
    }
    return new BrowserProvider(eth).getSigner()
}

export const cancelled = (e: unknown) => {
    const code = (e as { code?: unknown })?.code
    return code === 4001 || code === "ACTION_REJECTED"
}
export const why = (e: unknown) => (e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? String(e)

export type Call = { to: string; data: string }
type Caps = Record<string, { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }>

/** EIP-5792: does this wallet run several calls as one atomic batch on our chain? (v2 `atomic`, or v1 `atomicBatch`) */
export function canBatch(caps: Caps | undefined, chainHex: string): boolean {
    const c = caps?.[chainHex] ?? caps?.["0x0"] // "0x0": capabilities that hold on every chain
    return ["supported", "ready"].includes(c?.atomic?.status ?? "") || c?.atomicBatch?.supported === true
}

/** wallet_getCallsStatus → the batch's transaction hash once it landed, null while pending; throws if it failed. */
export function batchOutcome(s: { status?: number | string; receipts?: { transactionHash?: string; status?: string }[] }): string | null {
    const st = s?.status
    if (st === 100 || st === "PENDING") return null
    if (st === 200 || st === "CONFIRMED") {
        const r = s.receipts?.at(-1)
        if (!r?.transactionHash) throw new Error("the wallet reported the batch done without a receipt")
        if (r.status && r.status !== "0x1") throw new Error("the batch reverted")
        return r.transactionHash
    }
    throw new Error(st === 400 ? "the wallet did not send the batch" : st === 500 || st === 600 ? "the batch reverted" : `unexpected batch status ${st}`)
}

/**
 * Sends `calls` as one atomic EIP-5792 batch (one confirmation: approve + fund, for example) when the wallet supports
 * it, and resolves to the hash of the transaction that ran them. Resolves to null when the wallet cannot batch, so
 * the caller falls back to one transaction per call.
 */
export async function sendBatch(eth: Eip1193Provider, from: string, calls: Call[]): Promise<string | null> {
    const chainHex = "0x" + d.chainId.toString(16)
    let caps: Caps | undefined
    try {
        caps = await eth.request({ method: "wallet_getCapabilities", params: [from, [chainHex]] })
    } catch {
        return null // method unknown: a wallet without EIP-5792
    }
    if (!canBatch(caps, chainHex)) return null
    const sent = await eth.request({ method: "wallet_sendCalls", params: [{ version: "2.0.0", chainId: chainHex, from, atomicRequired: true, calls: calls.map((c) => ({ ...c, value: "0x0" })) }] })
    const id = typeof sent === "string" ? sent : sent.id // v1 answered a bare id, v2 an object
    for (let t = 0; t < 120; t++) {
        const h = batchOutcome(await eth.request({ method: "wallet_getCallsStatus", params: [id] }))
        if (h) return h
        await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error("the wallet has not confirmed the batch after 4 minutes; check it in the wallet")
}

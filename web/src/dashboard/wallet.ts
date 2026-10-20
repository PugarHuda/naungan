// Donations and audit signatures from any EIP-1193 wallet. EIP-6963 lists every installed wallet (MetaMask,
// Coinbase, Rabby…) without them fighting over window.ethereum; the first one announced is used, window.ethereum otherwise.
import { BrowserProvider, type Eip1193Provider } from "ethers"
import { deployment as d } from "../shared/chain"

type Announced = { info: { name: string }; provider: Eip1193Provider }
const wallets: Announced[] = []
window.addEventListener("eip6963:announceProvider", (e) => wallets.push((e as CustomEvent<Announced>).detail))
window.dispatchEvent(new Event("eip6963:requestProvider"))

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

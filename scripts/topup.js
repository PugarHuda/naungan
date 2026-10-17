// Send testnet ETH from a funded wallet to the service wallet in .env (coordinator/oracle/relayer).
//   PRIVATE_KEY=<funded key> AMOUNT=0.05 USDC=6 npx hardhat run scripts/topup.js --network baseSepolia
// The PRIVATE_KEY on the command line overrides .env for this run only, so read .env's key directly.
const fs = require("fs")
const path = require("path")
const { ethers } = require("hardhat")

async function main() {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)
    if (!env) throw new Error(".env has no PRIVATE_KEY")
    const to = new ethers.Wallet(env[1]).address
    const [from] = await ethers.getSigners()
    if (from.address === to) throw new Error("PRIVATE_KEY on the command line is the .env wallet itself: pass the funded key")
    const value = ethers.parseEther(process.env.AMOUNT ?? "0.05")
    const tx = await from.sendTransaction({ to, value })
    await tx.wait()
    console.log(`sent ${ethers.formatEther(value)} ETH ${from.address} → ${to} · ${tx.hash}`)
    if (process.env.USDC) {
        // Circle testnet USDC on Base Sepolia (developers.circle.com/stablecoins/usdc-contract-addresses)
        const usdc = await ethers.getContractAt("MockUSDC", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", from)
        const amt = ethers.parseUnits(process.env.USDC, 6)
        const t = await usdc.transfer(to, amt)
        await t.wait()
        console.log(`sent ${process.env.USDC} USDC → ${to} · ${t.hash}`)
    }
    console.log(`service wallet balance: ${ethers.formatEther(await ethers.provider.getBalance(to))} ETH`)
}

main().catch((e) => {
    console.error(e.shortMessage ?? e.message)
    process.exitCode = 1
})

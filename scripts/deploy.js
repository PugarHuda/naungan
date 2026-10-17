// Deploys Semaphore + Naungan and writes web/deployment.json for the web apps and services.
// Local:   npx hardhat node   then   npx hardhat run scripts/deploy.js --network localhost
// Testnet: PRIVATE_KEY in .env, then npx hardhat run scripts/deploy.js --network baseSepolia
const fs = require("fs")
const path = require("path")
const { ethers, run, network } = require("hardhat")

// Circle's official testnet USDC (developers.circle.com/stablecoins/usdc-contract-addresses).
// Only a local dev chain, where Circle has no contract, gets the MockUSDC test token.
const CIRCLE_USDC = { baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" }
const EXPLORER = { baseSepolia: "https://sepolia.basescan.org", sepolia: "https://sepolia.etherscan.io" }
// Blockscout etherscan-compatible API: event history without the RPC 200-block cap (free, no key, CORS open).
const INDEXER = { baseSepolia: "https://base-sepolia.blockscout.com/api", sepolia: "https://eth-sepolia.blockscout.com/api" }

async function main() {
    const [deployer] = await ethers.getSigners()
    if (!deployer) throw new Error("No account: set PRIVATE_KEY")
    const balance = await ethers.provider.getBalance(deployer.address)
    console.log(`deployer ${deployer.address} · ${ethers.formatEther(balance)} ETH on ${network.name}`)
    if (balance === 0n) throw new Error(`Deployer has 0 ETH: fund ${deployer.address} on ${network.name} first`)

    const { semaphore } = await run("deploy:semaphore", { logs: false })
    let usdc = CIRCLE_USDC[network.name]
    if (!usdc) {
        if (!["hardhat", "localhost"].includes(network.name)) throw new Error(`No Circle USDC address known for ${network.name}`)
        usdc = await (await (await ethers.getContractFactory("MockUSDC")).deploy()).getAddress()
    }
    const naungan = await (await ethers.getContractFactory("Naungan")).deploy(await semaphore.getAddress(), usdc)
    await naungan.waitForDeployment()

    const out = {
        network: network.name,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        rpc: network.config.url ?? "http://127.0.0.1:8545",
        explorer: EXPLORER[network.name] ?? null,
        indexer: INDEXER[network.name] ?? null,
        naungan: await naungan.getAddress(),
        usdc,
        usdcIsCircle: Boolean(CIRCLE_USDC[network.name]),
        semaphore: await semaphore.getAddress(),
        relayer: process.env.RELAYER_URL ?? "http://localhost:8788",
        fromBlock: (await naungan.deploymentTransaction().wait()).blockNumber
    }
    fs.writeFileSync(path.join(__dirname, "..", "web", "deployment.json"), JSON.stringify(out, null, 2) + "\n")
    console.log(out)
}

main().catch((e) => {
    console.error(e)
    process.exitCode = 1
})

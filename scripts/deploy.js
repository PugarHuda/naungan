// Deploys Semaphore + MockUSDC + Naungan and writes web/deployment.json for the dashboard.
// Local:   npx hardhat node   then   npx hardhat run scripts/deploy.js --network localhost
// Testnet: PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network baseSepolia
const fs = require("fs")
const path = require("path")
const { ethers, run, network } = require("hardhat")

async function main() {
    const [deployer] = await ethers.getSigners()
    if (!deployer) throw new Error("No account: set PRIVATE_KEY")
    const balance = await ethers.provider.getBalance(deployer.address)
    console.log(`deployer ${deployer.address} · ${ethers.formatEther(balance)} ETH on ${network.name}`)
    if (balance === 0n) throw new Error(`Deployer has 0 ETH: fund ${deployer.address} on ${network.name} first`)

    const { semaphore } = await run("deploy:semaphore", { logs: false })
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy()
    const naungan = await (await ethers.getContractFactory("Naungan")).deploy(await semaphore.getAddress(), await usdc.getAddress())
    await naungan.waitForDeployment()

    const out = {
        network: network.name,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        rpc: network.config.url ?? "http://127.0.0.1:8545",
        explorer: { baseSepolia: "https://sepolia.basescan.org", sepolia: "https://sepolia.etherscan.io" }[network.name] ?? null,
        naungan: await naungan.getAddress(),
        usdc: await usdc.getAddress(),
        semaphore: await semaphore.getAddress(),
        fromBlock: (await naungan.deploymentTransaction().wait()).blockNumber
    }
    fs.writeFileSync(path.join(__dirname, "..", "web", "deployment.json"), JSON.stringify(out, null, 2))
    console.log(out)
}

main().catch((e) => {
    console.error(e)
    process.exitCode = 1
})

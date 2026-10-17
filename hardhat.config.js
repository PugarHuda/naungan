try { process.loadEnvFile() } catch {} // ponytail: Node built-in .env loader, no dotenv dep
require("@nomicfoundation/hardhat-toolbox")
require("@semaphore-protocol/hardhat")

module.exports = {
    solidity: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } }
    },
    dependencyCompiler: {
        paths: [
            "@semaphore-protocol/contracts/Semaphore.sol",
            "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol",
            "poseidon-solidity/PoseidonT3.sol"
        ]
    },
    networks: {
        baseSepolia: {
            url: process.env.RPC_URL || "https://sepolia.base.org",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        },
        sepolia: {
            url: process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        }
    },
    mocha: { timeout: 300000 }
}

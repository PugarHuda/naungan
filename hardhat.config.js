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
        // LOCAL_RPC: a dev node on another port (npx hardhat node --port 8555) when 8545 is taken
        localhost: { url: process.env.LOCAL_RPC || "http://127.0.0.1:8545" },
        baseSepolia: {
            url: process.env.RPC_URL || "https://sepolia.base.org",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        },
        sepolia: {
            url: process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        }
    },
    // Source verification on Sourcify (no API key); Basescan reads Sourcify-verified sources too.
    sourcify: { enabled: true },
    etherscan: { enabled: false },
    mocha: { timeout: 300000 }
}

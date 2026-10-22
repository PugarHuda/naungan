// Mainnet rehearsal: Naungan on a fork of Base mainnet with Circle's real USDC, from deployment to refund, spending
// nothing. Opt-in, as it reads mainnet state over a public RPC: MAINNET_FORK=1 npx hardhat test test/mainnet-fork.test.js
// (FORK_URL to use another Base mainnet RPC). It shows the contract works with the token a real program would pay in.
const { expect } = require("chai")
const { ethers, run, network } = require("hardhat")
const { Identity, Group, generateProof } = require("@semaphore-protocol/core")

const FORK_URL = process.env.FORK_URL || "https://base-rpc.publicnode.com" // mainnet.base.org rate-limits a fork's many state reads
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Circle's native USDC on Base (developers.circle.com/stablecoins/usdc-contract-addresses)
const TRANSFER = ethers.id("Transfer(address,address,uint256)")

/** An address holding at least `need` real USDC on Base right now: a recent transfer's recipient. */
async function holder(usdc, need) {
    const rpc = new ethers.JsonRpcProvider(FORK_URL, 8453, { staticNetwork: true })
    const head = await rpc.getBlockNumber()
    const logs = await rpc.getLogs({ address: USDC, topics: [TRANSFER], fromBlock: head - 40, toBlock: head - 20 })
    for (const to of [...new Set(logs.map((l) => ethers.getAddress("0x" + l.topics[2].slice(26))))].slice(0, 15)) if ((await usdc.balanceOf(to)) >= need) return to
    throw new Error("no USDC holder found in recent blocks")
}

;(process.env.MAINNET_FORK ? describe : describe.skip)("mainnet rehearsal on a fork of Base with Circle's real USDC", function () {
    this.timeout(600000)
    after(() => network.provider.request({ method: "hardhat_reset", params: [] })) // back to the plain local chain for other tests

    it("deploys, funds from a real USDC holder, triggers, pays a zero-knowledge claim in real USDC and refunds the rest", async () => {
        const rpc = new ethers.JsonRpcProvider(FORK_URL, 8453, { staticNetwork: true })
        const block = (await rpc.getBlockNumber()) - 5 // a settled block, so every node serving the fork agrees on it
        await network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: FORK_URL, blockNumber: block } }] })
        await network.provider.send("evm_mine") // reads run on a block the fork mined, not on Base's history (Hardhat knows no Base hardfork dates)
        expect((await ethers.provider.getNetwork()).chainId).to.equal(31337n) // Hardhat's id, over Base mainnet's state
        const usdc = await ethers.getContractAt(["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)"], USDC)
        expect(await usdc.symbol()).to.equal("USDC")
        expect(await usdc.decimals()).to.equal(6n)

        const [coordinator, oracle, agency, relayer] = await ethers.getSigners()
        const { semaphore } = await run("deploy:semaphore", { logs: false })
        const naungan = await (await ethers.getContractFactory("Naungan")).deploy(await semaphore.getAddress(), USDC)

        // A real holder becomes the donor: impersonated on the fork, given gas, and its USDC is what funds the pool.
        const amount = 1_000_000n, households = 2n // 1 USDC each
        const whale = await holder(usdc, amount * households)
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [whale] })
        await network.provider.request({ method: "hardhat_setBalance", params: [whale, "0x56BC75E2D63100000"] })
        const donor = await ethers.getSigner(whale)
        const before = await usdc.balanceOf(whale)

        const now = (await ethers.provider.getBlock("latest")).timestamp
        const meta = JSON.stringify({ name: "Mainnet rehearsal · fork", hazard: "flood", lat: 5.575, lon: 95.325, returnPeriod: 5, leadDays: 10 })
        await (await naungan.createProgram([oracle.address], 1, amount, 60, 14 * 86400, now + 90 * 86400, meta)).wait()
        const pid = await naungan.programCount()
        await (await naungan.addAgency(pid, agency.address)).wait()
        const ids = [new Identity(), new Identity()]
        await (await naungan.connect(agency).enroll(pid, ids.map((i) => i.commitment))).wait()
        await (await usdc.connect(donor).approve(await naungan.getAddress(), amount * households)).wait()
        await (await naungan.connect(donor).fund(pid, amount * households)).wait()
        expect(await usdc.balanceOf(await naungan.getAddress())).to.equal(amount * households)

        await (await naungan.connect(oracle).reportIndex(pid, 80, "fork rehearsal: oracle report on a local fork, no forecast")).wait()
        const group = new Group(ids.map((i) => i.commitment))
        const payout = ethers.Wallet.createRandom().address
        const tx = await naungan.connect(relayer).claim(pid, await generateProof(ids[0], group, BigInt(payout), pid))
        const r = await tx.wait()
        expect(await usdc.balanceOf(payout)).to.equal(amount) // real FiatToken transfer to a fresh address
        console.log(`      claim gas on Base mainnet state: ${r.gasUsed}`)

        // Claims close; the donor pulls back the unclaimed household's share.
        await network.provider.send("evm_increaseTime", [15 * 86400])
        await network.provider.send("evm_mine")
        await (await naungan.connect(donor).refund(pid)).wait()
        expect(await usdc.balanceOf(whale)).to.equal(before - amount) // paid one household, got the other's money back
        expect(await usdc.balanceOf(await naungan.getAddress())).to.equal(0n)
    })
})

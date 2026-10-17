const { expect } = require("chai")
const { ethers, run, network } = require("hardhat")
const { Identity, Group, generateProof } = require("@semaphore-protocol/core")

const USDC = (n) => BigInt(n) * 10n ** 6n

describe("Naungan", () => {
    let naungan, usdc, coordinator, oracle, agencyA, agencyB, donor, relayer, outsider
    let households, group, programId

    before(async () => {
        ;[coordinator, oracle, agencyA, agencyB, donor, relayer, outsider] = await ethers.getSigners()
        const { semaphore } = await run("deploy:semaphore", { logs: false })
        usdc = await (await ethers.getContractFactory("MockUSDC")).deploy()
        naungan = await (await ethers.getContractFactory("Naungan")).deploy(await semaphore.getAddress(), await usdc.getAddress())

        await naungan.createProgram(oracle.address, USDC(50), 120, 7 * 24 * 3600)
        programId = 1n
        await naungan.addAgency(programId, agencyA.address)
        await naungan.addAgency(programId, agencyB.address)

        households = [0, 1, 2, 3].map(() => new Identity())
        group = new Group()
        households.forEach((h) => group.addMember(h.commitment))
        await naungan.connect(agencyA).enroll(programId, households.slice(0, 2).map((h) => h.commitment))
        await naungan.connect(agencyB).enroll(programId, households.slice(2).map((h) => h.commitment))

        await usdc.mint(donor.address, USDC(1000))
        await usdc.connect(donor).approve(await naungan.getAddress(), USDC(1000))
        await naungan.connect(donor).fund(programId, USDC(150)) // deliberately covers only 3 of 4
    })

    const proofFor = (identity, payout, scope = programId) => generateProof(identity, group, BigInt(payout), scope)

    it("rejects enrollment from non-agencies", async () => {
        await expect(naungan.connect(outsider).enroll(programId, [1n])).to.be.revertedWithCustomError(naungan, "NotAgency")
    })

    it("does not pay before the hazard trigger", async () => {
        const proof = await proofFor(households[0], outsider.address)
        await expect(naungan.claim(programId, proof)).to.be.revertedWithCustomError(naungan, "NotTriggered")
    })

    it("below-threshold report does not open claims; above-threshold does", async () => {
        await expect(naungan.connect(outsider).reportIndex(programId, 200)).to.be.revertedWithCustomError(naungan, "NotOracle")
        await naungan.connect(oracle).reportIndex(programId, 80)
        expect((await naungan.programs(programId)).claimDeadline).to.equal(0n)
        await naungan.connect(oracle).reportIndex(programId, 145)
        expect((await naungan.programs(programId)).claimDeadline).to.be.gt(0n)
    })

    it("pays an anonymous household via a relayer, exactly once", async () => {
        const payout = ethers.Wallet.createRandom().address
        const proof = await proofFor(households[0], payout)
        await naungan.connect(relayer).claim(programId, proof)
        expect(await usdc.balanceOf(payout)).to.equal(USDC(50))
        await expect(naungan.connect(relayer).claim(programId, proof)).to.be.revertedWithCustomError(naungan, "AlreadyClaimed")
    })

    it("a relayer cannot redirect the payout", async () => {
        const proof = await proofFor(households[1], ethers.Wallet.createRandom().address)
        const tampered = { ...proof, message: BigInt(relayer.address).toString() }
        await expect(naungan.connect(relayer).claim(programId, tampered)).to.be.revertedWithCustomError(naungan, "InvalidProof")
    })

    it("proofs for another program are rejected", async () => {
        const proof = await proofFor(households[1], outsider.address, 999n)
        await expect(naungan.claim(programId, proof)).to.be.revertedWithCustomError(naungan, "WrongScope")
    })

    it("never spends beyond the program's own pool", async () => {
        for (const h of households.slice(1, 3)) await naungan.claim(programId, await proofFor(h, ethers.Wallet.createRandom().address))
        const last = await proofFor(households[3], outsider.address)
        await expect(naungan.claim(programId, last)).to.be.revertedWithCustomError(naungan, "Underfunded")
    })

    it("returns unclaimed funds only after the window closes", async () => {
        await naungan.connect(donor).fund(programId, USDC(70))
        await expect(naungan.refundUnclaimed(programId)).to.be.revertedWithCustomError(naungan, "ClaimWindowOpen")
        await network.provider.send("evm_increaseTime", [8 * 24 * 3600])
        await network.provider.send("evm_mine")
        const before = await usdc.balanceOf(coordinator.address)
        await naungan.refundUnclaimed(programId)
        expect((await usdc.balanceOf(coordinator.address)) - before).to.equal(USDC(70))
    })
})

const { expect } = require("chai")
const { ethers, run, network } = require("hardhat")
const { Identity, Group, generateProof } = require("@semaphore-protocol/core")
const { poseidon2 } = require("poseidon-lite")

const USDC = (n) => BigInt(n) * 10n ** 6n
const DAY = 24 * 3600
const META = JSON.stringify({ name: "Krueng Aceh flood", lat: 5.55, lon: 95.32, returnPeriod: 5, leadDays: 10 })
const now = async () => (await ethers.provider.getBlock("latest")).timestamp
const warp = async (s) => (await network.provider.send("evm_increaseTime", [s]), network.provider.send("evm_mine"))

describe("Naungan", () => {
    let semaphoreAddr, usdc, naungan, coordinator, oracle, agencyA, agencyB, donor, relayer, outsider
    let households, group, programId

    before(async () => {
        ;[coordinator, oracle, agencyA, agencyB, donor, relayer, outsider] = await ethers.getSigners()
        const { semaphore } = await run("deploy:semaphore", { logs: false })
        semaphoreAddr = await semaphore.getAddress()
        usdc = await (await ethers.getContractFactory("MockUSDC")).deploy()
        naungan = await (await ethers.getContractFactory("Naungan")).deploy(semaphoreAddr, await usdc.getAddress())

        await naungan.createProgram(oracle.address, USDC(50), 60, 7 * DAY, (await now()) + 90 * DAY, META)
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

    it("validates program parameters", async () => {
        const end = (await now()) + DAY
        await expect(naungan.createProgram(ethers.ZeroAddress, 1, 60, DAY, end, META)).to.be.revertedWithCustomError(naungan, "BadParams")
        await expect(naungan.createProgram(oracle.address, 0, 60, DAY, end, META)).to.be.revertedWithCustomError(naungan, "BadParams")
        await expect(naungan.createProgram(oracle.address, 1, 60, DAY, await now(), META)).to.be.revertedWithCustomError(naungan, "BadParams")
    })

    it("stores hazard metadata and the group leaves on-chain", async () => {
        expect(JSON.parse(await naungan.metadata(programId)).lat).to.equal(5.55)
        expect(await naungan.members(programId)).to.deep.equal(households.map((h) => h.commitment))
    })

    it("rejects enrollment from non-agencies and from removed agencies", async () => {
        await expect(naungan.connect(outsider).enroll(programId, [1n])).to.be.revertedWithCustomError(naungan, "NotAgency")
        await expect(naungan.connect(outsider).removeAgency(programId, agencyB.address)).to.be.revertedWithCustomError(naungan, "NotCoordinator")
        await naungan.addAgency(programId, outsider.address)
        await naungan.removeAgency(programId, outsider.address)
        await expect(naungan.connect(outsider).enroll(programId, [1n])).to.be.revertedWithCustomError(naungan, "NotAgency")
    })

    it("refuses to fund a program that does not exist", async () => {
        await expect(naungan.connect(donor).fund(999, USDC(1))).to.be.revertedWithCustomError(naungan, "UnknownProgram")
    })

    it("does not pay before the hazard trigger", async () => {
        const proof = await proofFor(households[0], outsider.address)
        await expect(naungan.claim(programId, proof)).to.be.revertedWithCustomError(naungan, "NotTriggered")
    })

    it("below-threshold report does not open claims; above-threshold does, with evidence logged", async () => {
        await expect(naungan.connect(outsider).reportIndex(programId, 90, "x")).to.be.revertedWithCustomError(naungan, "NotOracle")
        await expect(naungan.connect(oracle).reportIndex(programId, 12, "GloFAS run 2026-10-17 | 6/51 members"))
            .to.emit(naungan, "IndexReported").withArgs(programId, 12, false, "GloFAS run 2026-10-17 | 6/51 members")
        expect((await naungan.programs(programId)).claimDeadline).to.equal(0n)
        await naungan.connect(oracle).reportIndex(programId, 71, "GloFAS run 2026-10-18 | 36/51 members")
        expect((await naungan.programs(programId)).claimDeadline).to.be.gt(0n)
        await expect(naungan.connect(oracle).reportIndex(programId, 99, "again")).to.be.revertedWithCustomError(naungan, "AlreadyTriggered")
        await expect(naungan.connect(agencyA).enroll(programId, [123n])).to.be.revertedWithCustomError(naungan, "AlreadyTriggered")
    })

    it("pays an anonymous household via a relayer, exactly once", async () => {
        const payout = ethers.Wallet.createRandom().address
        const proof = await proofFor(households[0], payout)
        await naungan.connect(relayer).claim(programId, proof)
        expect(await usdc.balanceOf(payout)).to.equal(USDC(50))
        await expect(naungan.connect(relayer).claim(programId, proof)).to.be.revertedWithCustomError(naungan, "AlreadyClaimed")
        // A fresh proof (new randomness, other payout) from the same household is still a double claim
        const again = await proofFor(households[0], outsider.address)
        await expect(naungan.connect(relayer).claim(programId, again)).to.be.revertedWithCustomError(naungan, "AlreadyClaimed")
    })

    it("the claim page's nullifier formula matches the circuit", async () => {
        const scopeHash = BigInt(ethers.keccak256(ethers.toBeHex(programId, 32))) >> 8n
        expect(await naungan.nullifierUsed(programId, poseidon2([scopeHash, households[0].secretScalar]))).to.equal(true)
        expect(await naungan.nullifierUsed(programId, poseidon2([scopeHash, households[1].secretScalar]))).to.equal(false)
    })

    it("a relayer cannot redirect the payout", async () => {
        const proof = await proofFor(households[1], ethers.Wallet.createRandom().address)
        const tampered = { ...proof, message: BigInt(relayer.address).toString() }
        await expect(naungan.connect(relayer).claim(programId, tampered)).to.be.revertedWithCustomError(naungan, "InvalidProof")
    })

    it("rejects proofs for another program and non-address payouts", async () => {
        const proof = await proofFor(households[1], outsider.address, 999n)
        await expect(naungan.claim(programId, proof)).to.be.revertedWithCustomError(naungan, "WrongScope")
        const huge = await generateProof(households[1], group, 2n ** 200n, programId)
        await expect(naungan.claim(programId, huge)).to.be.revertedWithCustomError(naungan, "BadPayout")
    })

    it("rejects a member of a different group", async () => {
        const stranger = new Identity()
        const fake = new Group([...households.map((h) => h.commitment), stranger.commitment])
        const proof = await generateProof(stranger, fake, BigInt(outsider.address), programId)
        const semaphore = await ethers.getContractAt("Semaphore", semaphoreAddr)
        await expect(naungan.claim(programId, proof)).to.be.revertedWithCustomError(semaphore, "Semaphore__MerkleTreeRootIsNotPartOfTheGroup")
    })

    it("never spends beyond the program's own pool", async () => {
        for (const h of households.slice(1, 3)) await naungan.claim(programId, await proofFor(h, ethers.Wallet.createRandom().address))
        const last = await proofFor(households[3], outsider.address)
        await expect(naungan.claim(programId, last)).to.be.revertedWithCustomError(naungan, "Underfunded")
    })

    it("returns unclaimed funds only after the window closes, then stops paying", async () => {
        await naungan.connect(donor).fund(programId, USDC(70))
        await expect(naungan.refundUnclaimed(programId)).to.be.revertedWithCustomError(naungan, "ClaimWindowOpen")
        await expect(naungan.connect(outsider).refundUnclaimed(programId)).to.be.revertedWithCustomError(naungan, "NotCoordinator")
        await warp(8 * DAY)
        await expect(naungan.claim(programId, await proofFor(households[3], outsider.address))).to.be.revertedWithCustomError(naungan, "ClaimWindowClosed")
        const before = await usdc.balanceOf(coordinator.address)
        await naungan.refundUnclaimed(programId)
        expect((await usdc.balanceOf(coordinator.address)) - before).to.equal(USDC(70))
    })

    it("refunds a program whose season ended without a trigger, and stops reports after it", async () => {
        await naungan.createProgram(oracle.address, USDC(10), 60, DAY, (await now()) + 30 * DAY, META)
        const pid = await naungan.programCount()
        await naungan.connect(donor).fund(pid, USDC(40))
        await expect(naungan.refundUnclaimed(pid)).to.be.revertedWithCustomError(naungan, "ClaimWindowOpen")
        await warp(31 * DAY)
        await expect(naungan.connect(oracle).reportIndex(pid, 100, "late")).to.be.revertedWithCustomError(naungan, "SeasonOver")
        const before = await usdc.balanceOf(coordinator.address)
        await naungan.refundUnclaimed(pid)
        expect((await usdc.balanceOf(coordinator.address)) - before).to.equal(USDC(40))
    })
})

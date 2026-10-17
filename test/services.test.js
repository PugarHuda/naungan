const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { parseLine, readHouseholds } = require("../lib/csv")
const { parseProof } = require("../scripts/relayer")

describe("services input validation", () => {
    it("parses quoted CSV cells and validates household rows", () => {
        expect(parseLine('"Begum, Fatimah",1990, kamp lhokseumawe ')).to.deep.equal(["Begum, Fatimah", "1990", "kamp lhokseumawe"])
        expect(parseLine('"say ""hi""",x')).to.deep.equal(['say "hi"', "x"])
        expect(() => parseLine('"open,1')).to.throw(/unterminated/)
        const f = path.join(os.tmpdir(), `naungan-${process.pid}.csv`)
        fs.writeFileSync(f, "﻿name,birthYear,village\r\nNur Kayas,1985,Kamp Pidie\r\n")
        expect(readHouseholds(f)).to.deep.equal([{ name: "Nur Kayas", birthYear: 1985, village: "Kamp Pidie" }])
        fs.writeFileSync(f, "name,birthYear,village\nNur Kayas,85x,Kamp Pidie\n")
        expect(() => readHouseholds(f)).to.throw(/row 2/)
        fs.unlinkSync(f)
    })

    it("relayer rejects malformed or mismatched proofs before touching the chain", () => {
        const proof = { merkleTreeDepth: 2, merkleTreeRoot: "1", nullifier: "2", message: "3", scope: "5", points: Array(8).fill("0") }
        expect(parseProof({ programId: "5", proof }).pid).to.equal(5n)
        expect(() => parseProof({ programId: "6", proof })).to.throw(/scope/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, points: [1] } })).to.throw(/malformed/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, merkleTreeDepth: 99 } })).to.throw(/range/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, nullifier: { x: 1 } } })).to.throw(/malformed/)
        expect(() => parseProof(null)).to.throw()
    })
})

describe("gasless spending (EIP-3009)", () => {
    const { ethers } = require("hardhat")
    const { parseTransfer } = require("../scripts/relayer")
    const TYPES = { TransferWithAuthorization: ["from:address", "to:address", "value:uint256", "validAfter:uint256", "validBefore:uint256", "nonce:bytes32"].map((x) => ({ name: x.split(":")[0], type: x.split(":")[1] })) }

    it("a household wallet with no ETH moves USDC through a relayer, once, as signed", async () => {
        const [relayer, shop] = await ethers.getSigners()
        const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy()
        const household = ethers.Wallet.createRandom()
        await usdc.mint(household.address, 50_000000n)
        const now = (await ethers.provider.getBlock("latest")).timestamp
        const msg = { from: household.address, to: shop.address, value: 20_000000n, validAfter: now - 60, validBefore: now + 3600, nonce: ethers.hexlify(ethers.randomBytes(32)) }
        const domain = { name: await usdc.name(), version: await usdc.version(), chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await usdc.getAddress() }
        const signature = await household.signTypedData(domain, TYPES, msg)
        const a = parseTransfer({ ...msg, value: msg.value.toString(), signature })
        const args = [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s]

        await expect(usdc.connect(relayer).transferWithAuthorization(a.from, relayer.address, ...args.slice(2))).to.be.revertedWith("invalid signature") // relayer cannot redirect
        await usdc.connect(relayer).transferWithAuthorization(...args)
        expect(await usdc.balanceOf(shop.address)).to.equal(20_000000n)
        expect(await ethers.provider.getBalance(household.address)).to.equal(0n)
        await expect(usdc.connect(relayer).transferWithAuthorization(...args)).to.be.revertedWith("authorization is used or canceled")
    })

    it("relayer rejects malformed authorizations", () => {
        const ok = { from: ethers.ZeroAddress, to: ethers.ZeroAddress, value: "1", validAfter: "0", validBefore: "9", nonce: ethers.ZeroHash, signature: "0x" + "11".repeat(32) + "22".repeat(32) + "1b" }
        expect(parseTransfer(ok).v).to.equal(27)
        expect(() => parseTransfer({ ...ok, from: "0x12" })).to.throw(/address/)
        expect(() => parseTransfer({ ...ok, value: "0" })).to.throw(/positive/)
        expect(() => parseTransfer({ ...ok, value: "-5" })).to.throw(/malformed/)
        expect(() => parseTransfer({ ...ok, nonce: "0x01" })).to.throw(/nonce/)
        expect(() => parseTransfer({ ...ok, signature: "0x00" })).to.throw(/signature/)
    })
})

const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { parseLine, readHouseholds } = require("../lib/csv")
const { parseProof, claimStatus, transferStatus, serialSender, sharedStore } = require("../scripts/relayer")

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

    it("reads commitments a household's phone made, for this program only, once each", () => {
        const { Identity } = require("@semaphore-protocol/core")
        const { parseCommitment } = require("../lib/csv")
        const c = new Identity().commitment
        expect(parseCommitment(`naungan-commitment:4:${c}`, 4n)).to.equal(c) // the scanned QR text
        expect(parseCommitment(String(c), 4n)).to.equal(c)
        expect(() => parseCommitment(`naungan-commitment:5:${c}`, 4n)).to.throw(/program 5/)
        expect(() => parseCommitment("0x12", 4n)).to.throw(/not a Naungan/)
        expect(() => parseCommitment("0", 4n)).to.throw(/range/)
        expect(() => parseCommitment("21888242871839275222246405745257275088548364400416034343698204186575808495617", 4n)).to.throw(/range/)
        const f = path.join(os.tmpdir(), `naungan-c-${process.pid}.csv`)
        fs.writeFileSync(f, `name,birthYear,village,commitment\nNur Kayas,1985,Kamp Pidie,naungan-commitment:4:${c}\nSiti Aminah,1990,Lambaro,\n`)
        const rows = readHouseholds(f, 4n)
        expect(rows[0].commitment).to.equal(c)
        expect(rows[1]).to.not.have.property("commitment") // no phone: gets a printed card
        fs.writeFileSync(f, `name,birthYear,village,commitment\nA B,1985,X,${c}\nC D,1990,Y,${c}\n`)
        expect(() => readHouseholds(f, 4n)).to.throw(/repeats/)
        fs.unlinkSync(f)
    })

    it("relayer rejects malformed or mismatched proofs before touching the chain", () => {
        const proof = { merkleTreeDepth: 2, merkleTreeRoot: "1", nullifier: "2", message: "3", scope: "5", points: Array(8).fill("0") }
        expect(parseProof({ programId: "5", proof }).pid).to.equal(5n)
        expect(() => parseProof({ programId: "6", proof })).to.throw(/scope/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, points: [1] } })).to.throw(/malformed/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, merkleTreeDepth: 99 } })).to.throw(/range/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, nullifier: { x: 1 } } })).to.throw(/malformed/)
        expect(() => parseProof({ programId: "5", proof: { ...proof, nullifier: "-1" } })).to.throw(/malformed/) // a negative never reaches ABI encoding
        expect(() => parseProof({ programId: "5", proof: { ...proof, points: [...proof.points.slice(1), (2n ** 256n).toString()] } })).to.throw(/malformed/)
        expect(() => parseProof(null)).to.throw()
    })

    it("relayer calls only the contract's own verdicts final, so a queued claim survives an RPC hiccup", () => {
        for (const v of ["AlreadyClaimed", "Underfunded", "ClaimWindowClosed", "NotTriggered", "WrongScope", "BadPayout"]) expect(claimStatus(v)).to.equal(422)
        // A lagging node that has not seen the newest group root, a timeout, a bare revert: retry, keep the proof.
        for (const v of ["Semaphore__MerkleTreeRootIsNotPartOfTheGroup", "request timeout", "transaction reverted without a reason (CALL_EXCEPTION)"]) expect(claimStatus(v)).to.equal(503)
        expect(transferStatus({ reason: "FiatTokenV2: invalid signature" })).to.equal(422)
        expect(transferStatus(new Error("fetch failed"))).to.equal(503)
    })

    it("relayer instances sharing a store never reuse a nonce, even when the RPC reports a stale pending count", async () => {
        const store = sharedStore({}) // the same object stands in for Redis shared by two serverless instances
        const stale = { getTransactionCount: async () => 3 } // a lagging node: never sees our own sends
        const a = serialSender(store, stale, "0xrelayer"), b = serialSender(store, stale, "0xrelayer")
        const used = []
        const send = async ({ nonce }) => (await new Promise((r) => setTimeout(r, Math.random() * 5)), used.push(nonce), { nonce })
        await Promise.all([...Array(8)].map((_, i) => (i % 2 ? a : b)(send)))
        expect(used.sort((x, y) => x - y)).to.deep.equal([3, 4, 5, 6, 7, 8, 9, 10])
        // Another process moved the chain past us: one "nonce too low" resyncs from the chain.
        const ahead = { getTransactionCount: async () => 20 }
        await store.del("naungan:nonce:0xother")
        let tries = 0
        const tx = await serialSender(store, ahead, "0xother")(async ({ nonce }) => { if (!tries++) throw Object.assign(new Error("nonce too low"), { code: "NONCE_EXPIRED" }); return { nonce } })
        expect(tx.nonce).to.equal(20)
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

describe("event history from the indexer", () => {
    const { topicsMatch } = require("../lib/chain")
    const sig = "0xc09f7b3c1c5b70bf6d30e485a4525d625d4723aed5d319376825446ef135c7ca", p = (n) => "0x" + n.toString(16).padStart(64, "0")
    it("keeps only logs whose indexed args match, like eth_getLogs (Claimed of program 2 is not program 1's)", () => {
        expect(topicsMatch([sig, p(2)], [sig, p(2)])).to.equal(true)
        expect(topicsMatch([sig, p(2)], [sig, p(1)])).to.equal(false)
        expect(topicsMatch([sig], [sig, p(1)])).to.equal(true) // no programId pinned: every program
        expect(topicsMatch([sig, null, p(7)], [sig, p(1), p(7)])).to.equal(true)
        expect(topicsMatch([sig, [p(1), p(2)]], [sig, p(2)])).to.equal(true) // OR within one position
        expect(topicsMatch([sig.toUpperCase().replace("0X", "0x"), p(2)], [sig, p(2)])).to.equal(true)
    })
})

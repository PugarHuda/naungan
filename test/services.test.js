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

    it("a caller whose lock expired cannot release the next holder's lock", async () => {
        const store = sharedStore({})
        expect(await store.claim("naungan:oracle:x", "slow", 0.01)).to.equal(true)
        await new Promise((r) => setTimeout(r, 20)) // the slow run outlives its TTL
        expect(await store.claim("naungan:oracle:x", "next", 300)).to.equal(true)
        await store.release("naungan:oracle:x", "slow") // the slow run's finally
        expect(await store.get("naungan:oracle:x")).to.equal("next")
        await store.release("naungan:oracle:x", "next")
        expect(await store.get("naungan:oracle:x")).to.equal(null)
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

describe("steady RPC reads", () => {
    const http = require("http")
    const { ethers } = require("ethers")
    const { SteadyProvider } = require("../lib/chain")
    // A node that answers the first `flaky` reads with empty data, as sepolia.base.org's load balancer sometimes does.
    const node = (flaky, asError = false) => {
        const seen = []
        const server = http.createServer((req, res) => {
            let body = ""
            req.on("data", (c) => (body += c)).on("end", () => {
                const out = [JSON.parse(body)].flat().map((p) => {
                    seen.push(p.method)
                    if (p.method !== "eth_call") return { jsonrpc: "2.0", id: p.id, result: "0xabc" }
                    if (flaky-- <= 0) return { jsonrpc: "2.0", id: p.id, result: ethers.toBeHex(7, 32) }
                    return asError ? { jsonrpc: "2.0", id: p.id, error: { code: -32000, message: "execution reverted" } } : { jsonrpc: "2.0", id: p.id, result: "0x" }
                })
                res.end(JSON.stringify(Array.isArray(JSON.parse(body)) ? out : out[0]))
            })
        })
        return new Promise((r) => server.listen(0, () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })))
    }
    const read = (url) => new ethers.Contract(ethers.ZeroAddress, ["function programCount() view returns (uint256)"], new SteadyProvider(url, 84532, { staticNetwork: true })).programCount()

    it("asks again when a read comes back empty, and gives up after two retries", async () => {
        const a = await node(2)
        expect(await read(a.url)).to.equal(7n)
        expect(a.seen.filter((m) => m === "eth_call")).to.have.length(3)
        a.server.close()
        const b = await node(3)
        await expect(read(b.url)).to.be.rejectedWith(/missing revert data|could not decode/)
        b.server.close()
        // The other way the node fails: an error with no revert data ("missing revert data" in the page).
        const c = await node(2, true)
        expect(await read(c.url)).to.equal(7n)
        expect(c.seen.filter((m) => m === "eth_call")).to.have.length(3)
        c.server.close()
    })
})

describe("waking phones when claims open (/notify)", () => {
    const { sharedStore, drain } = require("../scripts/relayer")
    const queue = async (store, n) => { for (let i = 0; i < n; i++) await store.add("q", `https://fcm.googleapis.com/fcm/send/${i}`, 3600) }

    it("every phone is woken once; gone ones dropped, refused ones kept for the next call", async () => {
        const store = sharedStore({})
        await queue(store, 1000)
        const seen = new Map()
        // 1 in 10 phones unsubscribed (410), 1 in 20 push services busy (429), one network failure.
        const wake = async (e) => {
            seen.set(e, (seen.get(e) ?? 0) + 1)
            const i = Number(e.split("/").pop())
            if (i === 7) throw new Error("fetch failed")
            return i % 10 === 0 ? 410 : i % 20 === 5 ? 429 : 201
        }
        const r = await drain(store, "q", wake)
        expect(seen.size).to.equal(1000)
        expect([...seen.values()].every((n) => n === 1)).to.equal(true)
        expect(r).to.deep.equal({ woke: 1000 - 100 - 50 - 1, retried: 51, more: false })
        expect((await store.members("q")).sort()).to.have.length(51) // the busy and the failed, for next time; never the 410s
    })

    it("a sender out of time stops between batches and loses nobody; two senders never wake one phone twice", async () => {
        const store = sharedStore({})
        await queue(store, 1000)
        const seen = new Map()
        const wake = async (e) => (seen.set(e, (seen.get(e) ?? 0) + 1), await new Promise((r) => setTimeout(r, 1)), 201)
        const first = await drain(store, "q", wake, { batch: 200, deadline: Date.now() + 15 })
        expect(first.more).to.equal(true)
        expect(first.woke).to.be.below(1000)
        expect((await store.members("q")).length).to.equal(1000 - first.woke) // the rest are still queued
        const [a, b] = await Promise.all([drain(store, "q", wake, { batch: 50 }), drain(store, "q", wake, { batch: 50 })])
        expect(first.woke + a.woke + b.woke).to.equal(1000)
        expect([...seen.values()].every((n) => n === 1)).to.equal(true)
    })
})

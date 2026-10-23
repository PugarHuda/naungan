const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { expect } = require("chai")
const { ethers } = require("ethers")
const hc = require("../lib/hypercert.mjs")

const A = "0x00000000000000000000000000000000000000aa"
const B = "0x00000000000000000000000000000000000000bb"
const C = "0x00000000000000000000000000000000000000cc"

// HypercertMinter's AllowlistMinter: leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount)))), sorted-pair proof.
const leaf = (a, u) => ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [a, u])))
const verify = (proof, root, l) => proof.reduce((h, p) => ethers.keccak256(ethers.concat(h < p ? [h, p] : [p, h])), l) === root

describe("Hypercert of a program's payouts (lib/hypercert.mjs)", () => {
    // Three donors gave 1, 1 and 1 USDC (one twice); 2 of 3 households paid 1 USDC each.
    const gifts = [{ donor: A, amount: 500_000n }, { donor: B, amount: 1_000_000n }, { donor: A, amount: 500_000n }, { donor: C, amount: 1_000_000n }]
    const pool = { funded: 3_000_000n, claims: 2n, amountPerHousehold: 1_000_000n }

    it("splits exactly 100M units pro rata to the gifts, as refund() splits the pool", () => {
        const s = hc.shares(gifts, pool)
        expect(s.map((x) => x.address)).to.deep.equal([A, B, C])
        expect(s.reduce((t, x) => t + x.units, 0n)).to.equal(hc.UNITS)
        expect(s.map((x) => x.units)).to.deep.equal([33_333_334n, 33_333_333n, 33_333_333n]) // the remainder goes to one donor, deterministically
        expect(s.map((x) => x.paid)).to.deep.equal([666_666n, 666_666n, 666_666n]) // floored, never more than was paid
    })

    it("refuses a snapshot whose gifts do not add up to the contract's pool", () => {
        expect(() => hc.shares(gifts.slice(1), pool)).to.throw(/wrong snapshot/)
    })

    it("builds the allowlist tree HypercertMinter checks, and finds each donor's proof", () => {
        const s = hc.shares(gifts, pool)
        const dump = JSON.stringify(hc.tree(s).dump())
        const root = hc.tree(s).root
        for (const x of s) {
            const p = hc.proofOf(dump, x.address.toUpperCase().replace("0X", "0x"))
            expect(p.units).to.equal(x.units)
            expect(p.leaf).to.equal(leaf(x.address, x.units))
            expect(verify(p.proof, root, p.leaf)).to.equal(true)
        }
        expect(hc.proofOf(dump, "0x00000000000000000000000000000000000000dd")).to.equal(null)
    })

    it("writes metadata in the Hypercerts schema, labelled as an exercise on testnet", () => {
        const m = hc.metadata({ programId: 1, name: "Krueng <Aceh> · Banda", hazard: "flood", evidence: "REPLAY of GloFAS", households: 3, paid: 6_000_000n, from: 1792424698, to: 1792428194, deadline: 1793634298, donors: [A], contract: "0x00E9", chainId: 84532, block: 1, base: "https://naungan.vercel.app", exercise: true })
        expect(m).to.include.keys("name", "description", "image", "version", "hypercert", "external_url", "properties")
        expect(m.hypercert).to.have.keys("impact_scope", "work_scope", "work_timeframe", "impact_timeframe", "contributors", "rights")
        expect(m.hypercert.work_timeframe.value).to.deep.equal([1792424698, 1792428194])
        expect(m.description).to.match(/testnet exercise/).and.match(/6 USDC/)
        const svg = Buffer.from(m.image.split(",")[1], "base64").toString()
        expect(svg).to.include("TESTNET EXERCISE").and.include("6 USDC").and.include("Krueng &#60;Aceh&#62;") // on-chain text escaped in the SVG
    })

    it("every recorded hypercert's files are the ones minted (sha256 in web/hypercerts.json)", () => {
        const list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "hypercerts.json"), "utf8"))
        const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", "web", "public", new URL(f).pathname))).digest("hex")
        for (const x of list) {
            expect(sha(x.uri)).to.equal(x.sha256)
            expect(sha(x.uri.replace(/\.json$/, "-allowlist.json"))).to.equal(x.allowListSha256)
            expect(hc.tree(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "public", new URL(x.uri).pathname.replace(/\.json$/, "-allowlist.json")))).values.map((v) => ({ address: v.value[0], units: BigInt(v.value[1]) }))).root).to.equal(x.root)
        }
    })
})

describe("Hypercerts evaluation of a minted certificate (lib/hypercert.mjs evaluate)", () => {
    // Program #1 as minted: the real files and entry, the real gifts and payout blocks.
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "hypercerts.json"), "utf8"))
    const entry = list.find((x) => x.programId === 1)
    const file = (u) => fs.readFileSync(path.join(__dirname, "..", "web", "public", new URL(u).pathname), "utf8")
    const metaText = file(entry.uri)
    const listText = file(entry.uri.replace(/\.json$/, "-allowlist.json"))
    const DONOR = "0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E"
    const gifts = [{ donor: DONOR, amount: 6_000_000n, block: 48328300 }]
    const payouts = [48329942, 48329947, 48329953].map((block) => ({ block, ok: true }))

    it("is valid on all four counts for the certificate as minted, and encodes under Hypercerts' registered schema", async () => {
        const v = await hc.evaluate({ entry, metaText, listText, gifts, payouts })
        expect(v).to.deep.include({ basic: 1, work: 1, contributors: 1, properties: 1 })
        expect(v.why).to.deep.equal([])
        expect(hc.EVAL_UID).to.equal("0x2f4f575d5df78ac52e8b124c4c900ec4c540f1d44f5b8825fac0af5308c91449") // as on Base Sepolia's SchemaRegistry
        const call = require("../lib/eas.mjs").EAS_ABI.decodeFunctionData("attest", hc.evaluationCall(entry, v, hc.evaluationComment(entry, v, "")))
        const [chain, minter, token, basic, , , , comment, tags] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "address", "uint256", "uint8", "uint8", "uint8", "uint8", "string", "string[]"], call[0].data.data)
        expect([Number(chain), minter, token.toString(), Number(basic)]).to.deep.equal([84532, hc.MINTER[84532], entry.claimID, 1])
        expect(comment).to.match(/^Re-checked against the chain: 3 payouts/)
        expect(tags).to.deep.equal(["naungan", "zk-payout-audit"])
    })

    it("marks each count invalid for what is actually wrong", async () => {
        // A payout failing the ZK audit, or one missing: the work.
        expect((await hc.evaluate({ entry, metaText, listText, gifts, payouts: [...payouts.slice(0, 2), { block: 48329953, ok: false }] })).work).to.equal(2)
        expect((await hc.evaluate({ entry, metaText, listText, gifts, payouts: payouts.slice(0, 2) })).work).to.equal(2)
        // Payouts after the snapshot do not count against it.
        expect((await hc.evaluate({ entry, metaText, listText, gifts, payouts: [...payouts, { block: entry.block + 10, ok: false }] })).work).to.equal(1)
        // A second donor before the snapshot whom the allowlist leaves out: the contributors.
        const v = await hc.evaluate({ entry, metaText, listText, gifts: [...gifts, { donor: "0x00000000000000000000000000000000000000aa", amount: 1_000_000n, block: 48330000 }], payouts })
        expect(v.contributors).to.equal(2)
        expect(v.why[0]).to.match(/^contributors: the allowlist is not the donors' pro-rata shares/)
        // A metadata file changed after mint: the properties; and its figures: the basics.
        const edited = metaText.replace("3 households paid", "30 households paid")
        const w = await hc.evaluate({ entry, metaText: edited, listText, gifts, payouts })
        expect([w.properties, w.basic]).to.deep.equal([2, 2])
        expect(hc.evaluationComment(entry, w, "")).to.match(/found problems/)
    })

    it("counts one evaluation per address, its newest, however often a key signs", () => {
        const e = (attester, time, verified) => ({ attester, time, verified })
        const out = hc.latestPerAttester([e(A, 1, true), e(A, 3, false), e(A.toUpperCase().replace("0X", "0x"), 2, true), e(B, 2, true)])
        expect(out.map((x) => [x.attester.toLowerCase(), x.time, x.verified])).to.deep.equal([[A, 3, false], [B, 2, true]])
    })
})

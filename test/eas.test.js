// Independent audits on EAS, against the real EAS and SchemaRegistry bytecode (the same contracts Base predeploys).
const { expect } = require("chai")
const { ethers } = require("hardhat")
const eas = require("../lib/eas.mjs")
const REG = require("@ethereum-attestation-service/eas-contracts/artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json")
const EAS = require("@ethereum-attestation-service/eas-contracts/artifacts/contracts/EAS.sol/EAS.json")

describe("independent payout audits (EAS)", () => {
    let registry, attestations, auditor, naungan
    before(async () => {
        ;[auditor] = await ethers.getSigners()
        registry = await new ethers.ContractFactory(REG.abi, REG.bytecode, auditor).deploy()
        attestations = await new ethers.ContractFactory(EAS.abi, EAS.bytecode, auditor).deploy(await registry.getAddress())
        naungan = ethers.Wallet.createRandom().address // the attestation's recipient: the audited deployment
    })

    it("computes the same schema UID the registry assigns", async () => {
        const rcpt = await (await registry.register(eas.SCHEMA, ethers.ZeroAddress, eas.REVOCABLE)).wait()
        const uid = rcpt.logs.map((l) => registry.interface.parseLog(l)).find((x) => x?.name === "Registered").args.uid
        expect(uid).to.equal(eas.schemaUid())
        expect((await registry.getSchema(uid)).schema).to.equal(eas.SCHEMA)
    })

    it("publishes an audit any reader can decode, signed by the auditor's own address", async () => {
        const audit = { programId: 2n, claims: 3, verified: 3, members: 4, groupRoot: 123456789n, atBlock: 777 }
        const rcpt = await (await auditor.sendTransaction({ to: await attestations.getAddress(), data: eas.attestCall(naungan, audit) })).wait()
        const uid = eas.attestedUid(rcpt)
        const a = await attestations.getAttestation(uid)
        expect(a.attester).to.equal(auditor.address)
        expect(a.recipient).to.equal(naungan)
        expect(a.schema).to.equal(eas.schemaUid())
        expect(a.revocable).to.equal(true)
        expect(eas.decodeAudit(a.data)).to.deep.include({ claims: 3, verified: 3, members: 4, atBlock: 777 })
        expect(eas.decodeAudit(a.data).groupRoot).to.equal(123456789n)
    })

    it("refuses data that is not a Naungan audit", () => {
        const other = ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint256", "uint256", "uint256", "uint256", "uint256", "uint64"], ["something-else", 1, 1, 1, 1, 1, 1])
        expect(() => eas.decodeAudit(other)).to.throw(/not a Naungan audit/)
    })

    it("counts each auditor once, by their newest audit, and separates clean from flagged", () => {
        const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40)
        const s = eas.summarise([
            { attester: A, atBlock: 10, claims: 2, verified: 1 }, // superseded by A's newer, clean audit
            { attester: A, atBlock: 20, claims: 3, verified: 3 },
            { attester: B, atBlock: 15, claims: 3, verified: 3 },
            { attester: C, atBlock: 16, claims: 3, verified: 2 }
        ])
        expect(s).to.deep.include({ auditors: 3, clean: 2, flagged: 1 })
    })
})

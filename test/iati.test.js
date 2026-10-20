const { expect } = require("chai")
const { spawnSync } = require("child_process")
const path = require("path")
const { iatiXml } = require("../api/iati")

// Validates against the official IATI 2.03 activity schema (test/fixtures/iati, from github.com/IATI/IATI-Schemas).
const py = ["python3", "python"].find((c) => spawnSync(c, ["-c", "import lxml"]).status === 0)
const iatiValid = (xml) => {
    const xsd = path.join(__dirname, "fixtures", "iati", "iati-activities-schema.xsd")
    const code = `import sys\nfrom lxml import etree\ns = etree.XMLSchema(etree.parse(sys.argv[1]))\nd = etree.fromstring(sys.stdin.buffer.read())\nprint("ok" if s.validate(d) else s.error_log)`
    const r = spawnSync(py, ["-c", code, xsd], { input: xml })
    return r.stdout.toString().trim() || r.stderr.toString().trim()
}

const d = { chainId: 84532, naungan: "0x00E9E8F7a9E8Dd4923Eb92eC5536f70ecD0C70f4" }
const base = { claimDeadline: 0n, seasonEnd: 1800000000n, triggerThreshold: 60n, amountPerHousehold: 2_000_000n, coordinator: "0x812D262d51eA66C863ecf58B2D5c246f2963d5a1" }
const meta = { name: "Krueng Aceh flood · Banda Aceh", hazard: "flood", lat: 5.575, lon: 95.325, returnPeriod: 5, leadDays: 10, country: "ID" }
const ev = (name, pid, at, args = {}, tx = `0x${name}${at}`) => ({ name, args: { programId: BigInt(pid), ...args }, timestamp: at, transactionHash: tx })
const DAY1 = 1792400000, DAY2 = DAY1 + 86400

describe("IATI 2.03 activity XML", () => {
    const programs = [
        { id: 1, p: { ...base, claimDeadline: 1792900000n }, meta }, // triggered, claims over by `now`
        { id: 2, p: base, meta: { name: "nowhere <test> & co", hazard: "heat", leadDays: 7 } } // watching, no location or country
    ]
    const events = [
        ev("ProgramCreated", 1, DAY1 - 9000),
        ev("Funded", 1, DAY1 - 5000, { donor: "0x39D2a1f4B1c0000000000000000000000000Cd7E", amount: 6_000_000n }),
        ev("Claimed", 1, DAY1, { payout: "0xaaaa" }), ev("Claimed", 1, DAY1 + 60, { payout: "0xbbbb" }), ev("Claimed", 1, DAY2, { payout: "0xcccc" }),
        ev("Refunded", 1, DAY2 + 900000, { donor: "0x39D2a1f4B1c0000000000000000000000000Cd7E", amount: 500_000n }),
        { name: "OracleAdded", args: {}, timestamp: DAY1 } // events without a program are ignored
    ]
    const xml = iatiXml({ programs, events, d, base: "https://naungan.vercel.app", now: 1793000000 })

    it("passes the official IATI 2.03 schema", function () {
        if (!py) return this.skip() // the schema check needs Python with lxml (CI installs it)
        expect(iatiValid(xml)).to.equal("ok")
    })

    it("each program is a humanitarian activity whose identifier starts with the reporting org's ref", () => {
        const org = `NAUNGAN-84532-${d.naungan}`
        expect(xml).to.include(`<iati-identifier>${org}-1</iati-identifier>`).and.include(`<iati-identifier>${org}-2</iati-identifier>`)
        expect(xml).to.include(`<reporting-org ref="${org}" type="90" secondary-reporter="1">`)
        expect(iatiXml({ programs, events, d, base: "https://x.org", org: "XM-DAC-41301" })).to.include("<iati-identifier>XM-DAC-41301-1</iati-identifier>")
        expect(xml.match(/humanitarian="1" xml:lang|xml:lang="en" default-currency="USD" humanitarian="1"/g)).to.have.length(2)
    })

    it("states status and dates: program 1 closed after its claim window, program 2 still implementing", () => {
        const [one, two] = xml.split("<iati-activity ").slice(1)
        expect(one).to.include('<activity-status code="4"/>').and.include('<activity-date type="2" iso-date="2026-10-19"/>').and.include('<activity-date type="4" iso-date="2026-10-25"/>')
        expect(one).to.include('<recipient-country code="ID" percentage="100"/>').and.include("<pos>5.575 95.325</pos>")
        expect(two).to.include('<activity-status code="2"/>').and.not.include("<location>").and.not.include("recipient-country").and.not.include('type="4"')
        expect(two).to.include("nowhere &lt;test&gt; &amp; co")
    })

    it("money, in date order: donation in, payouts one disbursement per day with no payout address, refund as negative incoming funds", () => {
        const tx = xml.match(/<transaction[ >].*?<\/transaction>/g)
        expect(tx).to.have.length(4)
        expect(tx[0]).to.include('<transaction-type code="1"/>').and.include(">6</value>").and.include("Donor 0x39D2…Cd7E")
        expect(tx[1]).to.include('<transaction-type code="3"/>').and.include('iso-date="2026-10-19"').and.include(">4</value>").and.include("2 anonymous enrolled households")
        expect(tx[2]).to.include(">2</value>").and.include("1 anonymous enrolled household<")
        expect(tx[3]).to.include('<transaction-type code="1"/>').and.include(">-0.5</value>").and.include("returned to the donor")
        for (const p of ["0xaaaa", "0xbbbb", "0xcccc"]) expect(xml).to.not.include(p)
        expect(xml).to.include('<aid-type code="1" vocabulary="4"/>') // IATI cash and voucher modalities: cash transfer
    })
})

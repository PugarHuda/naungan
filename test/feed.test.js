const { expect } = require("chai")
const { spawnSync } = require("child_process")
const { buildFeed } = require("../api/feed")
const { summarise } = require("../api/programs")

const T0 = 1_763_900_000 // 2025-11-23
const ev = (name, args, n, timestamp = T0 + n * 60) => ({ name, args, blockNumber: 100 + n, index: 0, transactionHash: "0x" + n.toString(16).padStart(64, "0"), timestamp })
const events = [
    ev("ProgramCreated", { programId: 1n, coordinator: "0xC0", amountPerHousehold: 2_000_000n, triggerThreshold: 60n, metadata: JSON.stringify({ name: "Krueng <Aceh> & flood" }) }, 1),
    ev("Funded", { programId: 1n, donor: "0xD0", amount: 6_000_000n }, 2),
    ev("IndexReported", { programId: 1n, oracle: "0x0A", value: 4n, agreeing: 0n, triggered: false, evidence: "GloFAS v4 | 4% \u0001" }, 3),
    ev("IndexReported", { programId: 1n, oracle: "0x0A", value: 100n, agreeing: 1n, triggered: true, evidence: "REPLAY of GloFAS v4 reanalysis | peak 963 m3/s on 2025-11-23" }, 4),
    ev("Claimed", { programId: 1n, nullifier: 11n, payout: "0xPAYOUT1" }, 5),
    ev("Claimed", { programId: 1n, nullifier: 12n, payout: "0xPAYOUT2" }, 6),
    ev("Claimed", { programId: 1n, nullifier: 13n, payout: "0xPAYOUT3" }, 7, T0 + 2 * 86400),
    ev("ProgramCreated", { programId: 2n, coordinator: "0xC0", amountPerHousehold: 1_000_000n, triggerThreshold: 50n, metadata: "not json" }, 8),
    ev("AgencyAdded", { programId: 1n, agency: "0xA9" }, 9)
]

/** Strict XML parse with expat (Python's standard library), the way a feed reader would reject a broken feed. */
function atom(xml) {
    const py = ["python3", "python"].find((c) => spawnSync(c, ["--version"]).status === 0)
    if (!py) return null
    const code = `import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.buffer.read()); a='{http://www.w3.org/2005/Atom}'
need=lambda e,t: (e.find(a+t) is not None and ((e.find(a+t).text or '').strip() or e.find(a+t).get('href') or e.find(a+t).find(a+'name') is not None)) or sys.exit('missing '+t)
[need(r,t) for t in ('id','title','updated','author')]
out=[]
for e in r.findall(a+'entry'):
  [need(e,t) for t in ('id','title','updated','link')]
  out.append({'title':e.find(a+'title').text,'updated':e.find(a+'updated').text,'links':[l.get('href') for l in e.findall(a+'link')]})
print(json.dumps({'id':r.find(a+'id').text,'updated':r.find(a+'updated').text,'entries':out}))`
    const p = spawnSync(py, ["-I", "-c", code], { input: xml })
    if (p.status !== 0) throw new Error(`not a valid Atom feed: ${p.stderr}`)
    return JSON.parse(p.stdout)
}

describe("open data: Atom feed and program summary", () => {
    it("the feed is valid Atom, newest first, and groups claims per day without payout addresses", function () {
        const xml = buildFeed({ events, base: "https://naungan.vercel.app", explorer: "https://sepolia.basescan.org" })
        expect(xml).to.not.match(/0xPAYOUT/) // a feed of who was paid when would help link payouts to people
        expect(xml).to.include("Krueng &lt;Aceh&gt; &amp; flood").and.not.include("\u0001")
        const f = atom(xml)
        if (!f) return this.skip() // no Python on this machine; CI's runner has it
        const titles = f.entries.map((e) => e.title)
        expect(titles).to.deep.equal([
            "Program #1 · Krueng <Aceh> & flood: 1 household paid on 2025-11-25",
            "Program #2",
            "Program #1 · Krueng <Aceh> & flood: 2 households paid on 2025-11-23",
            "CLAIMS OPEN · Program #1 · Krueng <Aceh> & flood: 100% (quorum reached, 1 oracle agrees)",
            "Program #1 · Krueng <Aceh> & flood: 4% (0 oracles at or above the trigger)",
            "Program #1 · Krueng <Aceh> & flood funded: 6.0 USDC",
            "New program: Program #1 · Krueng <Aceh> & flood"
        ].map((t) => (t === "Program #2" ? "New program: Program #2" : t)))
        expect(f.updated).to.equal(new Date((T0 + 2 * 86400) * 1000).toISOString())
        const opened = f.entries[3]
        expect(opened.links).to.deep.equal(["https://naungan.vercel.app/dashboard?program=1", `https://sepolia.basescan.org/tx/0x${(4).toString(16).padStart(64, "0")}`])
        expect(f.entries[0].links).to.have.length(1) // a claim group links the dashboard only, never the claim transactions
    })

    it("a program's feed holds only that program, and the feed id says which", function () {
        const xml = buildFeed({ events, base: "https://naungan.vercel.app", program: 2 })
        const f = atom(xml)
        if (!f) return this.skip()
        expect(f.id).to.equal("tag:naungan.vercel.app,2026:program:2")
        expect(f.entries.map((e) => e.title)).to.deep.equal(["New program: Program #2"])
    })

    it("summarises each program's state, money and latest report from chain data", () => {
        const p = (o) => ({ coordinator: "0xC0", quorum: 1n, groupId: 1n, amountPerHousehold: 2_000_000n, triggerThreshold: 60n, claimWindow: 0n, claimDeadline: 0n, lastIndex: 0n, enrolled: 3n, funded: 6_000_000n, claims: 0n, seasonEnd: BigInt(T0 + 1e6), ...o })
        const programs = [
            { id: 1, p: p({ claimDeadline: BigInt(T0 + 7 * 86400), lastIndex: 100n, claims: 3n }), meta: { name: "Krueng Aceh", hazard: "flood", lat: 5.55, lon: 95.32, returnPeriod: 5, leadDays: 10, country: "ID" } },
            { id: 2, p: p({ seasonEnd: BigInt(T0 - 1) }), meta: { name: "Dhaka", hazard: "heat", lat: 23.8, lon: 90.4, leadDays: 7, heat: { tmax: 42, tmin: 30, days: 2 } } }
        ]
        const [a, b] = summarise({ programs, events, base: "https://x.org", now: T0 + 86400, countries: { 2: "BD" } })
        expect(a).to.include({ id: 1, state: "claims open", until: new Date((T0 + 7 * 86400) * 1000).toISOString(), country: "ID", hazard: "flood" })
        expect(a.usdc).to.deep.equal({ perHousehold: 2, funded: 6, paidOut: 6, shortfall: 0 })
        expect(b.usdc.shortfall).to.equal(0) // over: 6 USDC short of nothing, donors take their shares back
        // The live program #3 before its top-up: 10 households × 0.25 owed, 1.52 in the pool. Exact in token units.
        const [c3] = summarise({ programs: [{ id: 3, p: p({ amountPerHousehold: 250_000n, enrolled: 10n, funded: 1_520_000n }), meta: {} }], events: [], base: "", now: T0 })
        expect(c3.usdc.shortfall).to.equal(0.98)
        const [c4] = summarise({ programs: [{ id: 4, p: p({ amountPerHousehold: 100_000n, enrolled: 3n, funded: 300_000n }), meta: {} }], events: [], base: "", now: T0 })
        expect(c4.usdc.shortfall).to.equal(0) // 0.1 × 3 is 0.30000000000000004 in floats; in token units it is exactly covered
        expect(a.households).to.deep.equal({ enrolled: 3, paid: 3 })
        expect(a.trigger.rule).to.equal("River flood: at least 60% of GloFAS members above the 1-in-5-year flood, 10-day lead")
        expect(a.latestReport).to.include({ valuePercent: 100, triggered: true })
        expect(a.links.join).to.equal("https://x.org/claim#join=1")
        expect(b).to.include({ state: "over", country: "BD", hazard: "heat", latestReport: null })
        expect(b.trigger.rule).to.match(/^Heatwave: 2\+ days above 42 °C, nights above 30 °C/)
    })
})

describe("open data: event history for the dashboard", () => {
    const { ethers } = require("ethers")
    const { eventsJson } = require("../api/programs")
    const iface = new ethers.Interface(require("../artifacts/contracts/Naungan.sol/Naungan.json").abi)
    const sample = { programId: 3n, agency: "0x39d2a1f4b1c0000000000000000000000000cd7e", households: 12n, donor: "0x812D262d51eA66C863ecf58B2D5c246f2963d5a1", amount: 6_000_000n, oracle: "0x01029664a642F8e3FF9171e79C9168d6Dc3C1248", value: 64n, agreeing: 2n, triggered: true, evidence: "glofas p=64 rp5 lead10", nullifier: 2n ** 200n + 7n, payout: "0x000000000000000000000000000000000000dEaD" }

    it("every event type survives the JSON and is re-encoded by the page into the same log", () => {
        let n = 0
        iface.forEachEvent((ev) => {
            const values = ev.inputs.map((i) => sample[i.name] ?? (i.type === "address" ? ethers.ZeroAddress : i.type === "bool" ? false : i.type === "string" ? "" : 1n))
            const log = iface.encodeEventLog(ev, values)
            const parsed = iface.parseLog(log) // what lib/chain.js allEvents hands load()
            const wire = JSON.parse(JSON.stringify(eventsJson({ d: { naungan: "0xC", chainId: 84532 }, head: 99, events: [{ name: parsed.name, args: parsed.args, blockNumber: 7, index: 1, transactionHash: "0xab", timestamp: 1 }] })))
            const e = wire.events[0]
            const again = iface.parseLog(iface.encodeEventLog(e.name, e.args)) // web/src/dashboard/state.svelte.ts fromApi
            expect(again.args.toArray(), ev.name).to.deep.equal(parsed.args.toArray())
            expect(iface.encodeEventLog(e.name, e.args), ev.name).to.deep.equal(log)
            n++
        })
        expect(n).to.be.greaterThanOrEqual(8)
    })
})

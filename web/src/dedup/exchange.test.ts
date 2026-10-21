import { describe, expect, it } from "vitest"
import { Wallet, getBytes, type Signer } from "ethers"
import { Agency } from "../../../lib/psi.mjs"
import { parseHouseholds } from "../../../lib/households.mjs"
import { digest, makeRequest, checkRequest, makeResponse, checkResponse, FRESH_MS, type Request } from "./exchange"

const me = { names: "id", chainId: 84532, naungan: "0x00E9E8F7a9E8Dd4923Eb92eC5536f70ecD0C70f4" }
const zakat = parseHouseholds('name,birthYear,village\n"Begum, Fatimah",1990,kamp lhokseumawe\nMohammed Rafiq,2001,Kamp Aceh Timur\nAbdul Karim,1980,Kamp Pidie\n')
const unhcr = parseHouseholds("name,birthYear,village\nFatima Begum,1990,Kamp Lhokseumawe\nNur Kayas,1985,Kamp Pidie\nAbdul Karim,1979,Kamp Pidie\n")

/** Agency A's side up to the file it sends: real keys, a real signature. */
async function request(wallet: Signer & { address: string }, ts = Date.now(), program = 7n) {
    const a = new Agency(zakat, { profile: "id" })
    const points = a.request()
    const signature = await wallet.signMessage(getBytes(digest(program, ts, points)))
    return { a, q: makeRequest({ ...me, program, ts, from: wallet.address, signature, points }) }
}

describe("dedup by file exchange", () => {
    const agency = Wallet.createRandom(), stranger = Wallet.createRandom()
    const isAgency = async (p: bigint, who: string) => p === 7n && who === agency.address

    it("A learns which of its households B serves, through two JSON files", async () => {
        const { a, q } = await request(agency)
        const sent = JSON.parse(JSON.stringify(q)) as Request // as it travels: a file
        expect(await checkRequest(sent, me, isAgency)).toBe(agency.address)
        const b = new Agency(unhcr, { profile: "id" })
        const back = JSON.parse(JSON.stringify(makeResponse(sent, b.respond(sent.points))))
        const found = a.intersect(checkResponse(back, q))
        expect([...found]).toEqual([0]) // Fatimah Begum, spelled the other way round
        expect([...found.near]).toEqual([2]) // Abdul Karim, one year apart: for a person to check
        expect(JSON.stringify(sent)).not.toMatch(/Fatimah|Begum|Rafiq|Karim|Lhokseumawe/i) // no name ever leaves A
        expect(JSON.stringify(back)).not.toMatch(/Fatima|Kayas|Karim|Pidie/i)
    })

    it("B refuses what it must not answer, saying why", async () => {
        const { q } = await request(agency)
        const no = (r: unknown, m: RegExp, who = me) => expect(checkRequest(r, who, isAgency)).rejects.toThrow(m)
        await no((await request(stranger)).q, /is not an agency of program #7/)
        await no({ ...q, points: [...q.points.slice(1), q.points[0]] }, /does not match its sender: the file was altered/)
        await no({ ...q, program: "8" }, /does not match its sender/) // the signature binds the program
        await no(q, /agree on one/, { ...me, names: "basic" })
        await no(q, /not this deployment/, { ...me, naungan: "0x0000000000000000000000000000000000000001" })
        await no((await request(agency, Date.now() - FRESH_MS - 1000)).q, /more than a week old/)
        await no({ ...q, v: "naungan-psi-v2" }, /update to the same release/)
        await no({ hello: 1 }, /not a Naungan dedup request/)
        await no({ ...q, points: ["zz"] }, /malformed/)
    })

    it("A takes only the answer to the request it still holds", async () => {
        const one = await request(agency), two = await request(agency)
        const b = new Agency(unhcr, { profile: "id" })
        const answerToTwo = makeResponse(two.q, b.respond(two.q.points))
        expect(() => checkResponse(answerToTwo, one.q)).toThrow(/answers a different request/)
        expect(() => checkResponse({ ...answerToTwo, doubled: [] }, two.q)).toThrow(/incomplete/)
        expect(() => checkResponse(one.q, one.q)).toThrow(/not a Naungan dedup response/)
    })
})

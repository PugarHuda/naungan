const { expect } = require("chai")
const crypto = require("crypto")
const http = require("http")
const { vapidKeys, validEndpoint, wake } = require("../lib/push")
const { sharedStore } = require("../scripts/relayer")

describe("Web Push alerts (RFC 8030 + VAPID RFC 8292)", () => {
    it("derives one stable P-256 VAPID key per relayer key", () => {
        const a = vapidKeys("0x" + "11".repeat(32)), b = vapidKeys("0x" + "11".repeat(32)), c = vapidKeys("0x" + "22".repeat(32))
        expect(a.publicKey).to.equal(b.publicKey).and.not.equal(c.publicKey)
        expect(Buffer.from(a.publicKey, "base64url")).to.have.length(65) // uncompressed point, as applicationServerKey takes
    })

    it("accepts only browser push services, so the relayer cannot be made to POST anywhere else", () => {
        for (const ok of ["https://fcm.googleapis.com/fcm/send/abc:APA91b", "https://updates.push.services.mozilla.com/wpush/v2/gAAA", "https://web.push.apple.com/QGx", "https://wns2-par02p.notify.windows.com/w/?token=x"])
            expect(validEndpoint(ok), ok).to.equal(true)
        for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://user@fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x", 42, "https://fcm.googleapis.com/" + "a".repeat(1100)])
            expect(validEndpoint(bad), String(bad).slice(0, 60)).to.equal(false)
    })

    it("sends an empty push with a VAPID JWT the push service can verify against our public key", async () => {
        const keys = vapidKeys("0x" + "33".repeat(32))
        let got
        const server = http.createServer((req, res) => { let n = 0; req.on("data", (c) => (n += c.length)); req.on("end", () => { got = { headers: req.headers, n }; res.writeHead(201).end() }) })
        await new Promise((r) => server.listen(0, "127.0.0.1", r))
        const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`
        try {
            expect(await wake(endpoint, keys, "https://naungan.vercel.app")).to.equal(201)
        } finally {
            server.close()
        }
        expect(got.n).to.equal(0) // no payload: nothing for the push service to read
        expect(got.headers.ttl).to.equal(String(3 * 86400))
        const [, t, k] = got.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/)
        expect(k).to.equal(keys.publicKey)
        const [h, p, sig] = t.split(".")
        const claims = JSON.parse(Buffer.from(p, "base64url"))
        expect(claims.aud).to.equal(new URL(endpoint).origin)
        expect(claims.sub).to.equal("https://naungan.vercel.app")
        expect(claims.exp - Date.now() / 1000).to.be.within(11 * 3600, 12 * 3600 + 1) // RFC 8292: at most 24 h
        const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"), Buffer.from(k, "base64url")]), format: "der", type: "spki" })
        expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).to.equal(true)
    })

    it("the store keeps each program's endpoints as a set", async () => {
        const s = sharedStore({})
        await s.add("k", "a", 60), await s.add("k", "b", 60), await s.add("k", "a", 60)
        expect((await s.members("k")).sort()).to.deep.equal(["a", "b"])
        await s.del("k")
        expect(await s.members("k")).to.deep.equal([])
    })
})

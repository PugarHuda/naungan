// The curve work off the page's thread: a few thousand households is ~100k hash-to-curve and scalar
// multiplications, seconds to minutes in JavaScript, and the page must stay usable meanwhile.
import { Agency } from "../../../lib/psi.mjs"

type Rec = { name: string; birthYear: number; village: string }
export type Job =
    | { op: "request"; records: Rec[]; names: string }
    | { op: "respond"; records: Rec[]; names: string; points: string[] }
    | { op: "intersect"; records: Rec[]; names: string; secret: string; layout: { i: number; near: boolean }[]; doubled: string[]; own: string[] }

self.onmessage = (e: MessageEvent<Job>) => {
    const j = e.data
    try {
        const a = new Agency(j.records, { profile: j.names })
        if (j.op === "request") {
            const points = a.request()
            postMessage({ points, secret: a.secret.toString(16), layout: a.layout })
        } else if (j.op === "respond") {
            postMessage(a.respond(j.points))
        } else {
            a.secret = BigInt("0x" + j.secret)
            a.layout = j.layout
            const dup = a.intersect({ doubled: j.doubled, own: j.own })
            postMessage({ dup: [...dup], near: [...dup.near] })
        }
    } catch (err) {
        postMessage({ error: (err as Error).message })
    }
}

// Private dedup between two agencies by exchanging two files, no server: the same 3-step DDH-PSI as
// scripts/agency.js (lib/psi.mjs), carried by files instead of HTTP, so an agency without a server, or without
// internet at the moment, can still check its list against another agency's.
//   1. Agency A: its list → request file (A's keys blinded with A's secret), signed by an agency wallet of the program.
//   2. Agency B: request file + its own list → response file (A's keys blinded again, B's own keys blinded, shuffled).
//      B answers only a request signed by an agency of that program on this contract (checked on-chain).
//   3. Agency A: response file → which of its households B already serves. B learns only how many keys A sent.
import { getBytes, id, solidityPackedKeccak256, verifyMessage } from "ethers"
import { DST } from "../../../lib/psi.mjs"

// As scripts/agency.js: binds the program, the time and the exact points, so a request is not replayed elsewhere.
export const digest = (program: bigint | number, ts: number, points: string[]) =>
    solidityPackedKeccak256(["string", "uint256", "uint256", "bytes32"], ["naungan-psi", program, ts, id(points.join(","))])

export const MAX_POINTS = 300000 // as scripts/agency.js: 10k households × ~30 keys
// A file travels by email or a USB stick, not in seconds as over HTTP (5 minutes there): a week.
export const FRESH_MS = 7 * 86400e3

export type Request = { kind: "naungan-psi-request"; v: string; names: string; chainId: number; naungan: string; program: string; ts: number; from: string; signature: string; points: string[] }
export type Response = { kind: "naungan-psi-response"; v: string; program: string; request: string; doubled: string[]; own: string[] }

export const requestHash = (r: Pick<Request, "points">) => id(r.points.join(","))

export function makeRequest(a: { names: string; chainId: number; naungan: string; program: bigint; ts: number; from: string; signature: string; points: string[] }): Request {
    return { kind: "naungan-psi-request", v: DST, ...a, program: a.program.toString() }
}

/**
 * Agency B's checks before answering, in the order a person can act on. `isAgency` reads the chain.
 * Returns the signer, an agency of the program.
 */
export async function checkRequest(r: unknown, me: { names: string; chainId: number; naungan: string }, isAgency: (program: bigint, who: string) => Promise<boolean>, now = Date.now()): Promise<string> {
    const q = r as Request
    if (q?.kind !== "naungan-psi-request") throw new Error("this is not a Naungan dedup request file")
    if (q.v !== DST) throw new Error(`the other agency runs dedup ${q.v}, this page runs ${DST}: update to the same release`)
    if (q.chainId !== me.chainId || q.naungan?.toLowerCase() !== me.naungan.toLowerCase()) throw new Error(`the request is for contract ${q.naungan} on chain ${q.chainId}, not this deployment`)
    // Different profiles normalise names differently: every key would differ and dedup would silently find nothing.
    if (q.names !== me.names) throw new Error(`the other agency matches names with the "${q.names}" profile, you chose "${me.names}": agree on one`)
    if (!/^\d{1,20}$/.test(q.program ?? "")) throw new Error("the request names no program")
    if (!Array.isArray(q.points) || !q.points.length || q.points.length > MAX_POINTS || !q.points.every((p) => typeof p === "string" && /^[0-9a-f]{64}$/.test(p))) throw new Error("the request's keys are malformed")
    if (!Number.isFinite(q.ts) || q.ts > now + 5 * 60e3 || now - q.ts > FRESH_MS) throw new Error("the request is more than a week old (or dated in the future): ask for a new one")
    let from: string
    try {
        from = verifyMessage(getBytes(digest(BigInt(q.program), q.ts, q.points)), q.signature)
    } catch {
        throw new Error("the request's signature is malformed")
    }
    if (from.toLowerCase() !== q.from?.toLowerCase()) throw new Error("the request's signature does not match its sender: the file was altered")
    if (!(await isAgency(BigInt(q.program), from))) throw new Error(`${from} is not an agency of program #${q.program}: only agencies of the same program may compare lists`)
    return from
}

export function makeResponse(q: Request, answer: { doubled: string[]; own: string[] }): Response {
    return { kind: "naungan-psi-response", v: DST, program: q.program, request: requestHash(q), ...answer }
}

/** Agency A's check that a response answers the request it still holds. */
export function checkResponse(r: unknown, sent: Request): Response {
    const s = r as Response
    if (s?.kind !== "naungan-psi-response") throw new Error("this is not a Naungan dedup response file")
    if (s.request !== requestHash(sent)) throw new Error("this response answers a different request (an older one, or another agency's)")
    if (!Array.isArray(s.doubled) || s.doubled.length !== sent.points.length || !Array.isArray(s.own)) throw new Error("the response is incomplete")
    return s
}

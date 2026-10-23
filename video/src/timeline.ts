// The cut: each spoken line keeps its stretch of the recording, and a stretch the page spent waiting (a public RPC, a
// proof being verified) is played faster, up to 3×, so the video moves at the pace of the narration.
export const FPS = 30
export const INTRO = 4 * FPS
export const CLOSE_TAIL = 2 * FPS
const GAP = 0.45 // seconds of breath after each line

export type Segment = { text: string; voice: string; voiceSecs: number; from?: number; to?: number }
export type Scene = { id: string; chapter: string; clip: string | null; segments: Segment[] }
export type Placed = Segment & { start: number; frames: number; rate: number; trim: number }
export type PlacedScene = Scene & { start: number; frames: number; index: number; lines: Placed[] }

export function timeline(scenes: Scene[]) {
    let at = INTRO
    const out: PlacedScene[] = scenes.map((s, index) => {
        const start = at
        const lines = s.segments.map((g) => {
            const spoken = g.voiceSecs + GAP
            const recorded = g.to !== undefined && g.from !== undefined ? g.to - g.from : spoken
            const secs = Math.max(spoken, Math.min(recorded, Math.max(spoken + 1.5, recorded / 3)))
            const frames = Math.round(secs * FPS)
            const placed = { ...g, start: at, frames, rate: Math.max(1, recorded / secs), trim: Math.round((g.from ?? 0) * FPS) }
            at += frames
            return placed
        })
        if (!s.clip) at += CLOSE_TAIL
        return { ...s, start, frames: at - start, index, lines }
    })
    return { scenes: out, total: at }
}

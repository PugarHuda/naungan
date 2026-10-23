// Naungan's live demo: the Playwright recordings of the live site (capture.cjs), cut to the narration, with chapter
// titles, captions, a progress bar and the AI voice. `npm run render` writes ../web/public/demo.mp4.
import React from "react"
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import manifest from "../public/manifest.json"
import { FPS, INTRO, timeline, type Placed, type PlacedScene, type Scene } from "./timeline"

const cut = () => timeline(manifest.scenes as Scene[])

const INK = "#0A0B0F"
const GREEN = "#3DD27B"
const FONT = "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif"

const fade = (frame: number, frames: number, edge = 8) =>
    interpolate(frame, [0, edge, frames - edge, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

const Caption: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
    const f = useCurrentFrame()
    const o = fade(f, frames, 6)
    const y = interpolate(f, [0, 8], [14, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })
    return (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 34 }}>
            <div style={{ opacity: o, transform: `translateY(${y}px)`, maxWidth: 1060, background: "rgba(10,11,15,.86)", color: "#fff", font: `600 25px/1.38 ${FONT}`, padding: "13px 22px", borderRadius: 14, textAlign: "center", boxShadow: "0 8px 30px rgba(0,0,0,.25)" }}>{text}</div>
        </AbsoluteFill>
    )
}

const Chapter: React.FC<{ scene: PlacedScene; count: number }> = ({ scene, count }) => {
    const f = useCurrentFrame()
    const { fps } = useVideoConfig()
    const s = spring({ frame: f, fps, config: { damping: 18 } })
    return (
        <div style={{ position: "absolute", left: 22, top: 22, display: "flex", alignItems: "center", gap: 10, transform: `translateX(${interpolate(s, [0, 1], [-40, 0])}px)`, opacity: s }}>
            <div style={{ background: GREEN, color: INK, font: `800 17px ${FONT}`, padding: "8px 11px", borderRadius: 10 }}>{String(scene.index + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}</div>
            <div style={{ background: "rgba(10,11,15,.86)", color: "#fff", font: `700 19px ${FONT}`, padding: "8px 14px", borderRadius: 10 }}>{scene.chapter}</div>
        </div>
    )
}

const Line: React.FC<{ clip: string | null; line: Placed }> = ({ clip, line }) => (
    <>
        {clip && <OffthreadVideo src={staticFile(clip)} trimBefore={line.trim} playbackRate={line.rate} muted style={{ width: "100%", height: "100%" }} />}
        <Audio src={staticFile(line.voice)} />
        <Caption text={line.text} frames={line.frames} />
    </>
)

const Intro: React.FC = () => {
    const f = useCurrentFrame()
    const { fps } = useVideoConfig()
    const s = spring({ frame: f, fps, config: { damping: 14 } })
    const o = fade(f, INTRO, 10)
    return (
        <AbsoluteFill style={{ background: INK, justifyContent: "center", alignItems: "center", opacity: o }}>
            <div style={{ textAlign: "center", transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})` }}>
                <div style={{ color: GREEN, font: `800 30px ${FONT}`, letterSpacing: 10 }}>NAUNGAN</div>
                <div style={{ color: "#fff", font: `800 74px/1.1 ${FONT}`, marginTop: 18 }}>Cash before the flood</div>
                <div style={{ color: "#B9C0C7", font: `500 26px ${FONT}`, marginTop: 22 }}>Live demo · recorded on naungan.vercel.app · Base Sepolia</div>
                <div style={{ width: interpolate(f, [10, 60], [0, 420], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }), height: 4, background: GREEN, margin: "30px auto 0", borderRadius: 2 }} />
            </div>
        </AbsoluteFill>
    )
}

const Close: React.FC<{ scene: PlacedScene }> = ({ scene }) => {
    const f = useCurrentFrame()
    const facts = ["No owner can change the rules", "Rehearsed on Base mainnet with real USDC", "242 automated tests", "Open source · MIT"]
    return (
        <AbsoluteFill style={{ background: INK, justifyContent: "center", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
                <div style={{ color: GREEN, font: `800 28px ${FONT}`, letterSpacing: 9 }}>NAUNGAN</div>
                <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", maxWidth: 1100, marginTop: 30 }}>
                    {facts.map((t, i) => {
                        const o = interpolate(f, [12 + i * 14, 26 + i * 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
                        return <div key={t} style={{ opacity: o, transform: `translateY(${(1 - o) * 12}px)`, border: `2px solid ${GREEN}`, color: "#fff", font: `700 24px ${FONT}`, padding: "12px 18px", borderRadius: 12 }}>{t}</div>
                    })}
                </div>
                <div style={{ color: "#fff", font: `800 64px ${FONT}`, marginTop: 46, opacity: interpolate(f, [70, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>naungan.vercel.app</div>
            </div>
            {scene.lines.map((l) => (
                <Sequence key={l.voice} from={l.start - scene.start} durationInFrames={l.frames}>
                    <Audio src={staticFile(l.voice)} />
                    <Caption text={l.text} frames={l.frames} />
                </Sequence>
            ))}
        </AbsoluteFill>
    )
}

export const Demo: React.FC = () => {
    const f = useCurrentFrame()
    const { scenes, total } = cut()
    const recorded = scenes.filter((s) => s.clip)
    return (
        <AbsoluteFill style={{ background: "#fff" }}>
            <Sequence durationInFrames={INTRO}><Intro /></Sequence>
            {scenes.map((s) =>
                s.clip ? (
                    <Sequence key={s.id} from={s.start} durationInFrames={s.frames}>
                        {s.lines.map((l) => (
                            <Sequence key={l.voice} from={l.start - s.start} durationInFrames={l.frames}>
                                <Line clip={s.clip} line={l} />
                            </Sequence>
                        ))}
                        <Chapter scene={s} count={recorded.length} />
                    </Sequence>
                ) : (
                    <Sequence key={s.id} from={s.start} durationInFrames={s.frames}><Close scene={s} /></Sequence>
                )
            )}
            <div style={{ position: "absolute", left: 0, top: 0, height: 5, width: `${(f / total) * 100}%`, background: GREEN }} />
        </AbsoluteFill>
    )
}

export const durationInFrames = () => cut().total
export { FPS }

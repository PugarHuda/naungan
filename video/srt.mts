// The captions as an SRT next to the video (web/public/demo.srt, the landing page's <track>), timed by the same cut
// Remotion renders (src/timeline.ts). Run after capture: node srt.mts
import fs from "node:fs"
import { FPS, timeline, type Scene } from "./src/timeline.ts"

const { scenes } = timeline(JSON.parse(fs.readFileSync(new URL("./public/manifest.json", import.meta.url), "utf8")).scenes as Scene[])
const t = (f: number) => new Date((f / FPS) * 1000).toISOString().slice(11, 23).replace(".", ",")
const lines = scenes.flatMap((s) => s.lines)
fs.writeFileSync(new URL("../web/public/demo.srt", import.meta.url), lines.map((l, i) => `${i + 1}\n${t(l.start)} --> ${t(l.start + l.frames)}\n${l.text}\n`).join("\n"))
console.log(`demo.srt: ${lines.length} captions`)

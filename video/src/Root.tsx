import React from "react"
import { Composition } from "remotion"
import { Demo, FPS, durationInFrames } from "./Demo"

export const Root: React.FC = () => <Composition id="Demo" component={Demo} durationInFrames={durationInFrames()} fps={FPS} width={1280} height={720} />

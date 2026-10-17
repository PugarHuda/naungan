// Landing hero: households (cubes) ride a metal belt through a glass gate, the zero-knowledge proof.
// Before the gate each one looks different (warm eyes, own tint: an identity); after it they are all
// alike (cyan eyes, one tint): the chain only sees "an enrolled household", never which one.
import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"

const canvas = document.getElementById("scene")
const still = matchMedia("(prefers-reduced-motion: reduce)").matches

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.9

const scene = new THREE.Scene()
// Bloom makes the canvas opaque, so the scene paints the page's navy glow itself and fades to the
// page colour (#070912) at the edges: no visible box around the canvas.
{
    const c = document.createElement("canvas")
    c.width = c.height = 512
    const g = c.getContext("2d")
    const r = g.createRadialGradient(300, 230, 10, 300, 230, 300)
    r.addColorStop(0, "#1d2458"), r.addColorStop(0.55, "#0d1130"), r.addColorStop(1, "#070912")
    g.fillStyle = r
    g.fillRect(0, 0, 512, 512)
    scene.background = new THREE.CanvasTexture(c)
    scene.background.colorSpace = THREE.SRGBColorSpace
}
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture

// Isometric-ish view down the belt, like a product shot.
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
camera.position.set(8.5, 9, 10.5)
camera.lookAt(-0.6, 0.4, 0.4)

// Perforated steel: a canvas texture of dots drives both the colour and the roughness.
function perforation() {
    const c = document.createElement("canvas")
    c.width = c.height = 256
    const g = c.getContext("2d")
    g.fillStyle = "#9aa3c7"
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = "#1a1d33"
    for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) g.beginPath(), g.arc(x, y, 2.6, 0, Math.PI * 2), g.fill()
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
}
const dots = perforation()
const tileMat = new THREE.MeshStandardMaterial({ map: dots, roughnessMap: dots, metalness: 0.85, roughness: 0.55, color: 0x8a92d8 })

// The belt runs along -x → +x through the gate at x = 0.
const belt = new THREE.Group()
const TILE = 1.9
for (let i = -5; i <= 5; i++)
    for (let j = -1; j <= 1; j++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(TILE - 0.06, 0.12, TILE - 0.06), tileMat)
        t.position.set(i * TILE, -0.06, j * TILE)
        belt.add(t)
    }
scene.add(belt)

// The gate: glass between two chrome posts, with a cyan glow strip on the floor under it.
const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecff, metalness: 1, roughness: 0.12 })
for (const z of [-1.55, 1.55]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 32), chrome)
    post.position.set(0, 1.3, z)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 32), chrome)
    foot.position.set(0, 0.04, z)
    scene.add(post, foot)
}
const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 2.2, 3.0),
    new THREE.MeshPhysicalMaterial({ color: 0x6fb8ff, metalness: 0, roughness: 0.18, transmission: 0.85, thickness: 0.6, ior: 1.45, transparent: true, opacity: 0.7, emissive: 0x1f6dff, emissiveIntensity: 0.5, side: THREE.DoubleSide })
)
glass.position.set(0, 1.25, 0)
const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 3.0), new THREE.MeshBasicMaterial({ color: 0x5fd0ff }))
strip.position.set(0, 0.01, 0)
// A lit frame so the pane reads as a gate from any angle.
const gateFrame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0x8fdcff }))
gateFrame.position.copy(glass.position)
scene.add(glass, strip, gateFrame)

// Households: a rounded metal cube with a dark screen face and two glowing eyes.
const bodyGeo = new RoundedBoxGeometry(1.05, 0.95, 1.05, 5, 0.22)
const faceGeo = new RoundedBoxGeometry(0.06, 0.6, 0.78, 3, 0.03)
const eyeGeo = new THREE.SphereGeometry(0.085, 20, 12)
const IDENTITY = [0xff4f9a, 0xffa24f, 0xff6b6b, 0xf5d76e, 0xc77dff] // each household before the gate
const TINTS = [0xa79be6, 0xd99ab8, 0x8fa8e0, 0xd8b48f, 0x93c9a8]
const ANON = new THREE.Color(0x4fe3ff)
const ANON_TINT = new THREE.Color(0x8e98e8)

const bots = []
const COUNT = 6, SPAN = TILE * 11
for (let k = 0; k < COUNT; k++) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: TINTS[k % 5], metalness: 0.9, roughness: 0.3 }))
    body.position.y = 0.5
    const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ color: 0x0b0d18, metalness: 0.2, roughness: 0.25 }))
    face.position.set(0.53, 0.52, 0)
    const eyeMat = new THREE.MeshBasicMaterial({ color: IDENTITY[k % 5] })
    for (const z of [-0.17, 0.17]) {
        const e = new THREE.Mesh(eyeGeo, eyeMat)
        e.scale.set(0.5, 1, 1)
        e.position.set(0.57, 0.56, z)
        g.add(e)
    }
    g.add(body, face)
    g.userData = { offset: (k / COUNT) * SPAN, lane: (k % 2 ? 0.55 : -0.55), body, eyeMat, id: new THREE.Color(IDENTITY[k % 5]), tint: new THREE.Color(TINTS[k % 5]) }
    scene.add(g)
    bots.push(g)
}

// Neon rim light: magenta from behind-left, electric blue from the gate.
scene.add(new THREE.AmbientLight(0x6670ff, 0.35))
const pink = new THREE.PointLight(0xff2d87, 30, 16)
pink.position.set(-4, 3.5, 4)
const blue = new THREE.PointLight(0x3aa0ff, 5, 6)
blue.position.set(0.6, 3.2, 0)
scene.add(pink, blue)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.9)
composer.addPass(bloom)
composer.addPass(new OutputPass())

function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    // Narrow screens: pull back so the gate and a few cubes stay in frame.
    camera.fov = w / h < 1 ? 38 : 28
    camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(canvas)
resize()

const clock = new THREE.Clock()
let visible = true
new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas)

function frame(t) {
    for (const b of bots) {
        const { offset, lane, body, eyeMat, id, tint } = b.userData
        const x = ((t * 0.9 + offset) % SPAN) - SPAN / 2
        b.position.set(x, Math.abs(Math.sin(t * 6 + offset)) * 0.03, lane)
        // Crossing the glass blends the identity away over half a tile.
        const k = THREE.MathUtils.smoothstep(x, -0.3, 0.6)
        eyeMat.color.copy(id).lerp(ANON, k)
        body.material.color.copy(tint).lerp(ANON_TINT, k)
    }
    glass.material.emissiveIntensity = 0.22 + Math.sin(t * 2) * 0.06
    composer.render()
}

if (still) frame(4.2)
else renderer.setAnimationLoop(() => visible && frame(clock.getElapsedTime()))
canvas.classList.add("ready")

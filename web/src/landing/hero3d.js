// Landing hero: households (white cubes) ride a belt through a glass gate, the zero-knowledge proof.
// Before the gate each one looks different (warm eyes, own tint: an identity); after it they are all
// alike (green eyes, one white): the chain only sees "an enrolled household", never which one.
// Styled like an architectural render: transparent canvas over the page, white satin, soft shadows.
import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

/** Starts the scene on `canvas`; returns a function that stops it and frees the GPU resources. */
export function start(canvas) {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = new THREE.Scene()
    // The far end of the belt dissolves into the page colour instead of ending at a hard edge.
    scene.fog = new THREE.Fog(0xf2f3f5, 15, 27)
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture

    // Isometric-ish view down the belt, like a product shot.
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(8.5, 9, 10.5)
    camera.lookAt(-0.6, 0.4, 0.4)

    // Perforated panels: a canvas texture of dots drives both the colour and the roughness.
    function perforation() {
        const c = document.createElement("canvas")
        c.width = c.height = 256
        const g = c.getContext("2d")
        g.fillStyle = "#c8ced4"
        g.fillRect(0, 0, 256, 256)
        g.fillStyle = "#8f98a1"
        for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) g.beginPath(), g.arc(x, y, 2.4, 0, Math.PI * 2), g.fill()
        const t = new THREE.CanvasTexture(c)
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 8
        return t
    }
    const dots = perforation()
    const tileMat = new THREE.MeshStandardMaterial({ map: dots, roughnessMap: dots, metalness: 0.05, roughness: 0.8, color: 0x8f98a1 })

    // The belt runs along -x → +x through the gate at x = 0.
    const TILE = 1.9
    for (let i = -5; i <= 5; i++)
        for (let j = -1; j <= 1; j++) {
            const t = new THREE.Mesh(new THREE.BoxGeometry(TILE - 0.06, 0.12, TILE - 0.06), tileMat)
            t.position.set(i * TILE, -0.06, j * TILE)
            t.receiveShadow = true
            scene.add(t)
        }

    // The gate: glass between two satin posts, with a green strip on the floor under it.
    const post = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.35 })
    for (const z of [-1.55, 1.55]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 32), post)
        p.position.set(0, 1.3, z)
        p.castShadow = true
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 32), post)
        foot.position.set(0, 0.04, z)
        scene.add(p, foot)
    }
    const glass = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 2.2, 3.0),
        new THREE.MeshPhysicalMaterial({ color: 0xdff7e8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false, emissive: 0x3dd27b, emissiveIntensity: 0.06, side: THREE.DoubleSide })
    )
    glass.position.set(0, 1.25, 0)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 3.0), new THREE.MeshBasicMaterial({ color: 0x3dd27b }))
    strip.position.set(0, 0.01, 0)
    const gateFrame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0x7d8a84 }))
    gateFrame.position.copy(glass.position)
    scene.add(glass, strip, gateFrame)

    // Households: a rounded satin cube with a dark screen face and two glowing eyes.
    const bodyGeo = new RoundedBoxGeometry(1.05, 0.95, 1.05, 5, 0.22)
    const faceGeo = new RoundedBoxGeometry(0.06, 0.6, 0.78, 3, 0.03)
    const eyeGeo = new THREE.SphereGeometry(0.085, 20, 12)
    const IDENTITY = [0xff7a59, 0xffb03b, 0xe85d75, 0xf2c94c, 0xb07cf0] // each household before the gate
    const TINTS = [0xe8c9b8, 0xcfc8e6, 0xbfd2e2, 0xe9d7a8, 0xc5dcca]
    const ANON = new THREE.Color(0x3dd27b)
    const ANON_TINT = new THREE.Color(0xffffff)

    const bots = []
    const COUNT = 6, SPAN = TILE * 11
    for (let k = 0; k < COUNT; k++) {
        const g = new THREE.Group()
        const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: TINTS[k % 5], metalness: 0.1, roughness: 0.35 }))
        body.position.y = 0.5
        body.castShadow = true
        const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ color: 0x0a0b0f, metalness: 0.3, roughness: 0.2 }))
        face.position.set(0.53, 0.52, 0)
        const eyeMat = new THREE.MeshBasicMaterial({ color: IDENTITY[k % 5] })
        for (const z of [-0.17, 0.17]) {
            const e = new THREE.Mesh(eyeGeo, eyeMat)
            e.scale.set(0.5, 1, 1)
            e.position.set(0.57, 0.56, z)
            g.add(e)
        }
        g.add(body, face)
        g.userData = { offset: (k / COUNT) * SPAN, lane: k % 2 ? 0.55 : -0.55, body, eyeMat, id: new THREE.Color(IDENTITY[k % 5]), tint: new THREE.Color(TINTS[k % 5]) }
        scene.add(g)
        bots.push(g)
    }

    // Daylight: a soft sky fill and one sun that casts long, blurred shadows across the belt.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c0c7, 0.55))
    const sun = new THREE.DirectionalLight(0xffffff, 2.8)
    sun.position.set(-6, 12, 7)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.radius = 6
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 8, bottom: -8, near: 1, far: 40 })
    scene.add(sun)

    function resize() {
        const { clientWidth: w, clientHeight: h } = canvas
        if (!w || !h) return
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        // Narrow screens: pull back so the gate and a few cubes stay in frame.
        camera.fov = w / h < 1 ? 38 : 28
        camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const clock = new THREE.Clock()
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(canvas)

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
        glass.material.emissiveIntensity = 0.05 + Math.sin(t * 2) * 0.03
        renderer.render(scene, camera)
    }

    if (still) frame(4.2)
    else renderer.setAnimationLoop(() => visible && frame(clock.getElapsedTime()))
    canvas.classList.add("ready")
    return () => {
        renderer.setAnimationLoop(null)
        ro.disconnect()
        io.disconnect()
        scene.traverse((o) => {
            o.geometry?.dispose()
            for (const m of [o.material].flat()) m?.dispose()
        })
        dots.dispose()
        scene.environment?.dispose()
        renderer.dispose()
        canvas.classList.remove("ready")
    }
}

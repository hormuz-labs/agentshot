// An original, procedural Pallas's cat: no remote models, textures, or animation downloads.
// Shared geometry and instanced, tapered fur keep the small desktop companion inexpensive to draw.
import * as T from 'three'
import type { MascotState } from '@/lib/mascot'

export type MascotScene = ReturnType<typeof createMascotScene>

export function createMascotScene(canvas: HTMLCanvasElement) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  const scene = new T.Scene()
  const camera = new T.OrthographicCamera(-2.05, 2.05, 2.05, -2.05, .1, 40)
  camera.position.set(0, 2.1, 9)
  camera.lookAt(0, .08, 0)
  scene.add(new T.HemisphereLight(0xfff5e7, 0x7e8799, 2.5))
  const light = (color: number, intensity: number, x: number, y: number, z: number) => {
    const l = new T.DirectionalLight(color, intensity); l.position.set(x, y, z); scene.add(l)
  }
  light(0xffedce, 3.2, -3, 5, 5)
  light(0xe0eaff, 1.9, 4, 2, -2)
  light(0xffffff, .6, 1, 0, 5)

  const geometries = new Set<T.BufferGeometry>()
  const materials = new Set<T.Material>()
  const textures = new Set<T.Texture>()
  const geometry = <G extends T.BufferGeometry>(g: G) => { geometries.add(g); return g }
  const material = (color: string, roughness = .9) => {
    const m = new T.MeshStandardMaterial({ color, roughness }); materials.add(m); return m
  }
  const coat = material('#99958c'), cheekCoat = material('#b7b0a2'), cream = material('#d3c6ac')
  const dark = material('#514943'), noseMat = material('#67504b', .65), earPink = material('#9e8578')
  const eyeMat = material('#c69639', .3), pupilMat = material('#171b18', .22), glintMat = material('#fff8e9', .12)
  const sphere = geometry(new T.SphereGeometry(1, 28, 20))
  const furGeometry = geometry(new T.ConeGeometry(1, 1, 4, 1))
  furGeometry.translate(0, .5, 0)
  const root = new T.Group(); scene.add(root)
  const body = new T.Group(); root.add(body)
  const head = new T.Group(); head.position.set(0, .47, .26); root.add(head)
  const mesh = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new T.Mesh(sphere, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m
  }
  // Stable, golden-angle strands with pale tips and a softly mottled undercoat.
  let seed = 8128
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const dummy = new T.Object3D(), normal = new T.Vector3(), up = new T.Vector3(0, 1, 0), color = new T.Color()
  function fluff(parent: T.Object3D, center: [number, number, number], radius: [number, number, number], count: number, length: number, base: string, face = false) {
    mesh(parent, base === '#99958c' ? coat : cheekCoat, ...center, ...radius)
    const mat = material(base)
    const strands = new T.InstancedMesh(furGeometry, mat, count)
    for (let i = 0; i < count; i++) {
      const y = 1 - 2 * (i + .5) / count, angle = i * 2.39996323
      const r = Math.sqrt(1 - y * y), x = Math.cos(angle) * r, z = Math.sin(angle) * r
      const len = length * (.55 + random() * .65) * (face && z > .6 ? .42 : 1)
      dummy.position.set(center[0] + x * radius[0], center[1] + y * radius[1], center[2] + z * radius[2])
      normal.set(x / radius[0], y / radius[1] - .22, z / radius[2]).normalize()
      dummy.quaternion.setFromUnitVectors(up, normal)
      dummy.scale.set(.004 + random() * .006, len, .004 + random() * .006)
      dummy.updateMatrix(); strands.setMatrixAt(i, dummy.matrix)
      const mottling = Math.sin(x * 15 + y * 9) * Math.cos(z * 14 - y * 11)
      color.set(base).multiplyScalar(.82 + random() * .37 + mottling * .08)
      strands.setColorAt(i, color)
    }
    strands.instanceMatrix.needsUpdate = true
    parent.add(strands)
  }
  fluff(body, [0, -.48, -.1], [.85, .83, .69], 2900, .12, '#99958c')
  mesh(body, cream, 0, -.52, .51, .55, .54, .22)
  fluff(head, [0, 0, 0], [1.02, .72, .64], 4200, .105, '#99958c', true)
  for (const side of [-1, 1]) {
    // Low, widely spaced, rounded ears are the Pallas's cat's distinctive silhouette.
    const ear = new T.Group(); ear.position.set(side * .9, .43, -.09); ear.rotation.z = side * -.22; head.add(ear)
    fluff(ear, [0, 0, 0], [.25, .3, .15], 440, .06, '#99958c')
    mesh(ear, dark, 0, .01, .105, .172, .22, .055)
    mesh(ear, earPink, 0, .02, .145, .118, .16, .028)
    fluff(head, [side * .74, -.23, .19], [.47, .41, .43], 1200, .15, '#b7b0a2', true)
  }
  const paws: T.Group[] = []
  for (const side of [-1, 1]) {
    const paw = new T.Group(); paw.position.set(side * .4, -1.04, .48); body.add(paw); paws.push(paw)
    fluff(paw, [0, 0, 0], [.27, .21, .32], 350, .055, '#b7b0a2')
    for (const dx of [-.06, .06]) mesh(paw, coat, dx, -.05, .295, .011, .066, .008)
  }
  // A thick, ringed tail curled beside its paws.
  const tail = new T.Group(); tail.position.set(.68, -.93, -.18); body.add(tail)
  const tailCurve = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(.49, .03, .01), new T.Vector3(.64, -.01, .46), new T.Vector3(.29, -.07, .87)])
  const tailMesh = new T.Mesh(geometry(new T.TubeGeometry(tailCurve, 24, .15, 10, false)), coat); tail.add(tailMesh)
  for (const t of [.38, .55, .72, .89]) {
    const point = tailCurve.getPoint(t), tangent = tailCurve.getTangent(t)
    const ring = new T.Mesh(geometry(new T.TorusGeometry(.151, .033, 6, 16)), dark)
    ring.position.copy(point); ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), tangent); tail.add(ring)
  }
  mesh(tail, dark, .29, -.07, .87, .152, .152, .16)

  const eyes: T.Group[] = [], brows: T.Mesh[] = []
  for (const side of [-1, 1]) {
    mesh(head, dark, side * .395, .035, .586, .245, .185, .085)
    const eye = new T.Group(); eye.position.set(side * .395, .035, .651); head.add(eye); eyes.push(eye)
    mesh(eye, eyeMat, 0, 0, 0, .185, .145, .05)
    mesh(eye, pupilMat, side * -.013, 0, .05, .073, .092, .021) // round pupils, unlike a domestic cat
    mesh(eye, glintMat, -.044, .049, .074, .029, .022, .008)
    mesh(eye, glintMat, .039, -.04, .069, .011, .009, .006)
    const brow = mesh(head, coat, side * .385, .19, .638, .285, .082, .075)
    brow.rotation.z = side * .15; brows.push(brow)
    // Dark tear stripes and tiny forehead markings.
    for (let i = 0; i < 2; i++) {
      const mark = mesh(head, dark, side * (.58 + i * .105), -.13 - i * .095, .59 - i * .05, .028, .14, .012)
      mark.rotation.z = side * .67
    }
    for (let i = 0; i < 2; i++) {
      const mark = mesh(head, dark, side * (.18 + i * .18), .44, .485, .024, .071, .012)
      mark.rotation.z = side * -.3
    }
  }
  mesh(head, cream, 0, -.19, .627, .27, .19, .15)
  mesh(head, cream, -.17, -.32, .69, .25, .17, .15)
  mesh(head, cream, .17, -.32, .69, .25, .17, .15)
  const nose = mesh(head, noseMat, 0, -.225, .813, .12, .072, .055)
  nose.rotation.z = Math.PI
  const mouth = new T.Group(); mouth.position.set(0, -.39, .817); head.add(mouth)
  mesh(mouth, dark, 0, 0, 0, .072, .022, .015)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) mesh(head, dark, side * (.15 + (i % 2) * .065), -.3 - i * .044, .843 - i * .012, .012, .012, .008)
    // Fine, softly lit whiskers. Curves follow the muzzle instead of flat screen-space strokes.
    for (let i = 0; i < 3; i++) {
      const curve = new T.QuadraticBezierCurve3(new T.Vector3(side * .21, -.33 - i * .035, .82), new T.Vector3(side * .62, -.25 - i * .12, .91), new T.Vector3(side * .98, -.21 - i * .17, .71))
      const whisker = new T.Mesh(geometry(new T.TubeGeometry(curve, 10, .005, 3, false)), cream); head.add(whisker)
    }
  }
  // Baked contact shadow: no live shadow maps or postprocessing while a video is playing.
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64
  const ctx = shadowCanvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(35,27,21,.28)'); gradient.addColorStop(.5, 'rgba(35,27,21,.13)'); gradient.addColorStop(1, 'rgba(35,27,21,0)')
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64)
  const shadowTexture = new T.CanvasTexture(shadowCanvas); textures.add(shadowTexture)
  const shadowMaterial = new T.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }); materials.add(shadowMaterial)
  const shadow = new T.Mesh(geometry(new T.PlaneGeometry(3.35, 2.1)), shadowMaterial)
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(.08, -1.29, .05); scene.add(shadow)

  let previous = 0, currentState: MascotState = 'idle', entered = 0, pointerX = 0, pointerY = 0
  let hopAt = -100, sleeping = 0
  const damp = (from: number, to: number, dt: number) => T.MathUtils.damp(from, to, 8, dt)
  function render(time: number, state: MascotState, reduced: boolean, pointer: { x: number; y: number }, darkTheme: boolean) {
    const dt = reduced ? 10 : Math.min(Math.max(time - previous, .001), .1); previous = time
    if (state !== currentState) { currentState = state; entered = time }
    const t = reduced ? 0 : time, age = reduced ? 10 : time - entered
    pointerX = damp(pointerX, reduced ? 0 : pointer.x, dt); pointerY = damp(pointerY, reduced ? 0 : pointer.y, dt)
    sleeping = damp(sleeping, state === 'sleeping' ? 1 : 0, dt)
    const work = state === 'working', thinking = state === 'thinking', talk = state === 'speaking'
    const celebrating = state === 'success' && age < 2.3
    const hopAge = t - hopAt
    const hop = !reduced && hopAge >= 0 && hopAge < .85 ? Math.sin(hopAge / .85 * Math.PI) * .4 : 0
    const bounce = reduced ? 0 : celebrating ? Math.abs(Math.sin(age * 5)) * .17 * Math.max(0, 1 - age / 2.3) : work ? Math.sin(t * 5.5) * .025 : 0
    const breath = Math.sin(t * (state === 'sleeping' ? 1.7 : 2.3)) * .012
    root.position.y = damp(root.position.y, bounce + hop, dt)
    root.scale.set(1 - hop * .1, 1 + breath + hop * .12, 1 - hop * .05)
    root.rotation.y = damp(root.rotation.y, -.09 + pointerX * .13 + (!reduced && work ? Math.sin(t * 2.2) * .035 : 0), dt)
    const yaw = pointerX * .19 + (reduced ? 0 : Math.sin(t * .56) * .065)
    head.rotation.y = damp(head.rotation.y, yaw, dt)
    head.rotation.x = damp(head.rotation.x, sleeping * .17 + pointerY * .1 + (state === 'error' ? .07 : thinking ? -.055 : 0), dt)
    head.rotation.z = damp(head.rotation.z, thinking ? -.13 + Math.sin(t * 1.2) * .025 : state === 'waiting' ? .1 : state === 'error' ? -.09 : celebrating ? Math.sin(age * 5) * .065 : Math.sin(t * .7) * .018, dt)
    head.position.y = .47 + breath
    tail.rotation.y = damp(tail.rotation.y, reduced ? 0 : Math.sin(t * (work ? 3 : 1.4)) * (work ? .15 : .065), dt)
    paws.forEach((paw, i) => {
      paw.position.y = -1.04 + (reduced ? 0 : work ? Math.max(0, Math.sin(t * 7 + i * Math.PI)) * .11 : celebrating ? .07 : 0)
      paw.rotation.x = work && !reduced ? Math.sin(t * 7 + i * Math.PI) * .13 : 0
    })
    const blinkPhase = t % 5.7
    const blink = !reduced && blinkPhase > 5.42 ? Math.sin((blinkPhase - 5.42) / .28 * Math.PI) : 0
    eyes.forEach(eye => { eye.scale.y = Math.max(.055, (1 - sleeping * .93) * (1 - blink * .95)) })
    brows.forEach((brow, i) => {
      brow.rotation.z = damp(brow.rotation.z, (i === 0 ? -1 : 1) * (state === 'error' ? -.12 : thinking ? .22 : .15), dt)
      brow.position.y = .19 + (talk ? .022 : 0) - sleeping * .035
    })
    mouth.scale.y = damp(mouth.scale.y, talk && !reduced ? 1 + Math.max(0, Math.sin(t * 11)) * 2.2 : 1, dt)
    shadowMaterial.opacity = darkTheme ? .48 : .85
    shadow.scale.setScalar(1 - hop * .22)
    renderer.render(scene, camera)
  }
  return {
    render,
    hop(time: number) { hopAt = time },
    resize(width: number, height: number) {
      renderer.setSize(width, height, false)
      const aspect = width / height
      camera.left = -2.05 * aspect; camera.right = 2.05 * aspect; camera.updateProjectionMatrix()
    },
    dispose() {
      scene.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose() })
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose())
      renderer.dispose(); renderer.forceContextLoss()
    },
  }
}

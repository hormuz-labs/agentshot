// An original, procedural Pallas's cat: no remote models, textures, or animation downloads.
// Shared geometry and instanced, tapered fur keep the small desktop companion inexpensive to draw.
import * as T from 'three'
import type { MascotState } from '@/lib/mascot'
import { blinkAmount, gestureDuration, gesturePose, runningLeg, type MascotGesture } from '@/lib/mascot-motion'

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
  const ears: T.Group[] = []
  for (const side of [-1, 1]) {
    // Low, widely spaced, rounded ears are the Pallas's cat's distinctive silhouette.
    const ear = new T.Group(); ear.position.set(side * .9, .43, -.09); ear.rotation.z = side * -.22; head.add(ear)
    ears.push(ear)
    fluff(ear, [0, 0, 0], [.25, .3, .15], 440, .06, '#99958c')
    mesh(ear, dark, 0, .01, .105, .172, .22, .055)
    mesh(ear, earPink, 0, .02, .145, .118, .16, .028)
    fluff(head, [side * .74, -.23, .19], [.47, .41, .43], 1200, .15, '#b7b0a2', true)
  }
  const paws: T.Group[] = [], arms: T.Group[] = [], elbows: T.Group[] = []
  for (const side of [-1, 1]) {
    const arm = new T.Group(); arm.position.set(side * .43, -.45, .37); body.add(arm); arms.push(arm)
    fluff(arm, [0, -.18, 0], [.16, .23, .17], 220, .045, '#99958c')
    const elbow = new T.Group(); elbow.position.y = -.38; arm.add(elbow); elbows.push(elbow)
    fluff(elbow, [0, -.15, 0], [.13, .21, .14], 180, .035, '#99958c')
    const paw = new T.Group(); paw.position.set(0, -.21, .11); elbow.add(paw); paws.push(paw)
    fluff(paw, [0, 0, 0], [.27, .21, .32], 350, .055, '#b7b0a2')
    for (const dx of [-.06, .06]) mesh(paw, coat, dx, -.05, .295, .011, .066, .008)
    // Paw pads appear when the front leg turns up to wave.
    mesh(paw, earPink, 0, -.19, .08, .1, .025, .12)
    for (const dx of [-.12, 0, .12]) mesh(paw, noseMat, dx, -.16, .23, .045, .025, .05)
  }
  const hindLegs: T.Group[] = [], hocks: T.Group[] = [], hindPaws: T.Group[] = []
  for (const side of [-1, 1]) {
    const leg = new T.Group(); leg.position.set(side * .48, -.48, -.53); body.add(leg); hindLegs.push(leg)
    fluff(leg, [0, -.16, 0], [.23, .25, .23], 300, .055, '#99958c')
    const hock = new T.Group(); hock.position.y = -.38; leg.add(hock); hocks.push(hock)
    fluff(hock, [0, -.15, 0], [.14, .21, .15], 180, .035, '#99958c')
    const paw = new T.Group(); paw.position.set(0, -.16, .1); hock.add(paw); hindPaws.push(paw)
    fluff(paw, [0, 0, 0], [.22, .16, .27], 240, .045, '#b7b0a2')
    for (const dx of [-.06, .06]) mesh(paw, coat, dx, -.05, .25, .011, .06, .008)
  }
  // Linked tail joints uncurl behind the runner; the wave travels all the way to the tip.
  const tail = new T.Group(); tail.position.set(.68, -.93, -.18); body.add(tail)
  const tailJoints: T.Group[] = []
  let tailParent = tail
  for (let i = 0; i < 7; i++) {
    const joint = new T.Group(); joint.position.z = i ? -.19 : 0; tailParent.add(joint)
    const radius = .16 - i * .008
    mesh(joint, i === 6 ? dark : coat, 0, 0, -.095, radius, radius, .16)
    if (i > 1 && i < 6) {
      const ring = new T.Mesh(geometry(new T.TorusGeometry(radius, .025, 6, 16)), dark)
      ring.position.z = -.12; joint.add(ring)
    }
    tailJoints.push(joint); tailParent = joint
  }

  const eyes: T.Group[] = [], pupils: T.Group[] = [], brows: T.Mesh[] = []
  for (const side of [-1, 1]) {
    mesh(head, dark, side * .395, .035, .586, .245, .185, .085)
    const eye = new T.Group(); eye.position.set(side * .395, .035, .651); head.add(eye); eyes.push(eye)
    mesh(eye, eyeMat, 0, 0, 0, .185, .145, .05)
    const pupil = new T.Group(); eye.add(pupil); pupils.push(pupil)
    mesh(pupil, pupilMat, side * -.013, 0, .05, .073, .092, .021) // round pupils, unlike a domestic cat
    mesh(pupil, glintMat, -.044, .049, .074, .029, .022, .008)
    mesh(pupil, glintMat, .039, -.04, .069, .011, .009, .006)
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
  const mouthInside = mesh(mouth, dark, 0, -.025, -.012, .09, .065, .025)
  const jaw = new T.Group(); jaw.position.set(0, -.005, 0); mouth.add(jaw)
  mesh(jaw, cream, 0, -.055, -.005, .14, .053, .055)
  const tongue = mesh(mouth, earPink, 0, -.055, .014, .045, .021, .01)
  const fangGeometry = geometry(new T.ConeGeometry(.013, .047, 8)); fangGeometry.rotateZ(Math.PI)
  for (const side of [-1, 1]) {
    const fang = new T.Mesh(fangGeometry, glintMat); fang.position.set(side * .055, -.015, .019); mouth.add(fang)
  }
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
  let gesture: MascotGesture | null = null, gestureAt = -100, sleeping = 0, pressure = 0
  let nextBlink = 2.2, blinkAt = -100, doubleBlink = false, nextFidget = 8, fidget = 0, busyPose = 0
  const damp = (from: number, to: number, dt: number) => T.MathUtils.damp(from, to, 8, dt)
  function render(time: number, state: MascotState, reduced: boolean, pointer: { x: number; y: number }, darkTheme: boolean, pressed = false) {
    const dt = reduced ? 10 : Math.min(Math.max(time - previous, .001), .1); previous = time
    if (state !== currentState) {
      currentState = state; entered = time
      if (!reduced && state === 'success') { gesture = 'wave'; gestureAt = time }
      else if (!reduced && state === 'waiting') { gesture = 'peek'; gestureAt = time }
      else if (!reduced && state === 'error') { gesture = 'growl'; gestureAt = time }
      else if (!reduced && state === 'sleeping') { gesture = 'yawn'; gestureAt = time }
    }
    const t = reduced ? 0 : time, age = reduced ? 10 : time - entered
    pointerX = T.MathUtils.damp(pointerX, reduced ? 0 : pointer.x, 22, dt); pointerY = T.MathUtils.damp(pointerY, reduced ? 0 : pointer.y, 22, dt)
    pressure = T.MathUtils.damp(pressure, pressed && !reduced ? 1 : 0, 35, dt)
    sleeping = damp(sleeping, state === 'sleeping' ? 1 : 0, dt)
    const work = state === 'working', thinking = state === 'thinking', talk = state === 'speaking'
    const running = !reduced && (work || thinking || talk)
    busyPose = damp(busyPose, running ? 1 : 0, dt)
    const stride = t * 11
    const celebrating = state === 'success' && age < 2.3
    if (!reduced && state === 'idle' && time > nextFidget && !pressed && !gesture) {
      gesture = fidget++ % 3 === 2 ? 'yawn' : 'peek'; gestureAt = time
      nextFidget = time + 13 + random() * 8
    }
    const gestureAge = t - gestureAt
    const pose = gesturePose(reduced ? null : gesture, gestureAge)
    if (gesture && gestureAge > gestureDuration[gesture]) gesture = null
    const hop = pose.lift
    const bounce = reduced ? 0 : celebrating ? Math.abs(Math.sin(age * 5)) * .17 * Math.max(0, 1 - age / 2.3) : 0
    const breath = Math.sin(t * (state === 'sleeping' ? 1.7 : 2.3)) * .012
    const runBob = Math.sin(stride * 2) * .045
    root.position.y = bounce + hop - pressure * .035 + busyPose * (.06 + runBob)
    const stretch = pose.squash - pressure * .08
    root.scale.set(1 - stretch * .45, 1 + breath + stretch, 1 - stretch * .25)
    root.scale.multiplyScalar(1 - busyPose * .1)
    // A right-facing profile exposes the four-legged gallop in real 3D.
    root.rotation.y = damp(root.rotation.y, running ? Math.PI / 2 : -.09 + pointerX * .13, dt)
    root.rotation.x = busyPose * Math.sin(stride) * .035
    body.scale.z = 1 + busyPose * (.12 + Math.cos(stride) * .035)
    head.position.z = .26 + busyPose * .5
    const yaw = (1 - busyPose) * (pointerX * .16 + (reduced ? 0 : Math.sin(t * .56) * .04))
    head.rotation.y = damp(head.rotation.y, yaw, dt)
    head.rotation.x = damp(head.rotation.x, sleeping * .17 + pointerY * .085 + pose.lean + (state === 'error' ? .07 : thinking ? -.055 : 0), dt)
    head.rotation.z = damp(head.rotation.z, pose.tilt + (1 - busyPose) * (thinking ? -.13 + Math.sin(t * 1.2) * .025 : state === 'waiting' ? .1 : state === 'error' ? -.09 : celebrating ? Math.sin(age * 5) * .065 : Math.sin(t * .7) * .018), dt)
    head.position.y = .47 + breath - busyPose * .3
    tail.position.set(.68 * (1 - busyPose), -.93 + busyPose * .62, -.18 - busyPose * .57)
    tail.rotation.y = T.MathUtils.lerp(-1.8, 0, busyPose)
    tailJoints.forEach((joint, i) => {
      joint.rotation.y = T.MathUtils.lerp(-.35, Math.sin(stride * .55 - i * .55) * .1, busyPose)
      joint.rotation.x = busyPose * (.055 + Math.sin(stride * .8 - i * .6) * .16)
    })
    paws.forEach((paw, i) => {
      const side = i === 0 ? -1 : 1
      const raise = i === 1 ? pose.paw : 0
      const gait = runningLeg(stride / (Math.PI * 2) + i * .12, runBob)
      arms[i].position.x = side * (.43 + raise * .5 * (1 - busyPose))
      arms[i].position.y = -.45 + raise * .5 * (1 - busyPose)
      arms[i].rotation.x = T.MathUtils.lerp(raise * -2.25, gait.hip, busyPose)
      elbows[i].rotation.x = busyPose * gait.knee
      arms[i].rotation.z = (raise * .8 + (i === 1 ? pose.wave : 0)) * (1 - busyPose)
      paw.position.y = T.MathUtils.lerp(-.21, -.36, busyPose)
      paw.rotation.x = T.MathUtils.lerp(raise * -.55, gait.ankle, busyPose)
      paw.rotation.z = i === 1 ? pose.wave * .5 : 0
    })
    hindLegs.forEach((leg, i) => {
      const gait = runningLeg(stride / (Math.PI * 2) + .5 + i * .12, runBob, true)
      leg.rotation.x = busyPose * gait.hip
      hocks[i].rotation.x = busyPose * gait.knee
      hindPaws[i].position.y = T.MathUtils.lerp(-.16, -.36, busyPose)
      hindPaws[i].rotation.x = busyPose * gait.ankle
    })
    if (!reduced && time >= nextBlink) { blinkAt = time; doubleBlink = random() > .72; nextBlink = time + 2.4 + random() * 4 }
    const blink = reduced ? 0 : blinkAmount(time - blinkAt, doubleBlink)
    eyes.forEach((eye, i) => {
      eye.scale.y = Math.max(.035, (1 - sleeping * .96) * (1 - Math.max(blink, pose.squint) * .96))
      pupils[i].position.x = pointerX * .065
      pupils[i].position.y = -pointerY * .046
      pupils[i].scale.setScalar(gesture === 'peek' ? 1.06 : 1)
    })
    ears.forEach((ear, i) => {
      const side = i === 0 ? -1 : 1
      const twitch = reduced ? 0 : Math.max(0, Math.sin(t * 1.3 + i * 2) - .97) * 2
      ear.rotation.z = side * (-.22 + pose.ears + twitch)
      ear.rotation.x = sleeping * -.15 + pose.mouth * -.13
    })
    brows.forEach((brow, i) => {
      brow.rotation.z = damp(brow.rotation.z, (i === 0 ? -1 : 1) * (state === 'error' ? -.12 : thinking ? .22 : .15), dt)
      brow.position.y = .19 + (talk ? .022 : 0) - sleeping * .035
    })
    const opening = Math.max(pose.mouth, talk && !reduced ? .08 + Math.max(0, Math.sin(t * 11)) * .12 : 0)
    mouthInside.scale.y = .015 + opening * .075
    jaw.position.y = -.005 - opening * .115
    tongue.visible = opening > .2
    mouth.children.forEach(o => { if (o instanceof T.Mesh && o.geometry === fangGeometry) o.visible = opening > .45 })
    shadowMaterial.opacity = darkTheme ? .48 : .85
    shadow.scale.setScalar(1 - hop * .22)
    renderer.render(scene, camera)
    // Tiny pose diagnostics for the actual rig, without React updates on every animation frame.
    canvas.dataset.gazeX = pointerX.toFixed(3); canvas.dataset.gazeY = pointerY.toFixed(3)
    canvas.dataset.blink = Math.max(blink, pose.squint).toFixed(3)
    canvas.dataset.paw = pose.paw.toFixed(3); canvas.dataset.lift = hop.toFixed(3)
    canvas.dataset.gesture = gesture ?? 'none'
    canvas.dataset.mouth = opening.toFixed(3)
    canvas.dataset.rotationY = root.rotation.y.toFixed(3)
    canvas.dataset.busyPose = busyPose.toFixed(3)
    canvas.dataset.legAngles = [...arms, ...hindLegs].map(leg => leg.rotation.x.toFixed(3)).join(',')
    canvas.dataset.jointAngles = [...elbows, ...hocks].map(joint => joint.rotation.x.toFixed(3)).join(',')
    canvas.dataset.tailWave = tailJoints.map(joint => joint.rotation.x.toFixed(3)).join(',')
  }
  return {
    render,
    /** Reproducible, straight-on full-body brand portrait; uses the exact same geometry as the companion. */
    renderLogo(size = 1024) {
      renderer.setPixelRatio(1); renderer.setSize(size, size, false)
      camera.left = -1.7; camera.right = 1.7; camera.top = 1.7; camera.bottom = -1.7
      camera.position.set(.12, .08, 9); camera.lookAt(.12, .08, 0); camera.updateProjectionMatrix()
      render(0, 'idle', true, { x: 0, y: 0 }, false)
      root.rotation.set(0, 0, 0); head.rotation.set(0, 0, 0)
      shadowMaterial.opacity = .45
      renderer.render(scene, camera)
      return canvas.toDataURL('image/png')
    },
    react(kind: MascotGesture, time: number) { gesture = kind; gestureAt = time; nextFidget = time + 15; if (kind === 'pet') { blinkAt = time + .12; doubleBlink = false } },
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

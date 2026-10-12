export type MascotGesture = 'pet' | 'wave' | 'growl' | 'nuzzle' | 'peek' | 'yawn'
export const gestureDuration: Record<MascotGesture, number> = { pet: .72, wave: 1.6, growl: 1.05, nuzzle: 1.4, peek: 1.2, yawn: 2 }
export const petGestures: MascotGesture[] = ['pet', 'wave', 'nuzzle', 'growl']

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const smooth = (n: number) => { const x = clamp(n, 0, 1); return x * x * (3 - 2 * x) }
const windowed = (age: number, duration: number, attack = .12, release = .2) =>
  smooth(age / attack) * (1 - smooth((age - duration + release) / release))

/** Fast eyes, slower head: bounded attention across the whole window, not just the hit area. */
export function cursorGaze(clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }) {
  const dx = clientX - (bounds.left + bounds.width * .5)
  const dy = clientY - (bounds.top + bounds.height * .43)
  return { x: clamp(dx / Math.max(160, bounds.width * 1.5), -1, 1), y: clamp(dy / Math.max(140, bounds.height * 1.5), -1, 1) }
}

/** Authored timing, not a second eased bounce. Anticipation → lift → soft landing → settle. */
export function gesturePose(gesture: MascotGesture | null, age: number) {
  const pose = { lift: 0, squash: 0, lean: 0, tilt: 0, paw: 0, wave: 0, mouth: 0, squint: 0, ears: 0 }
  if (!gesture || age < 0 || age > gestureDuration[gesture]) return pose
  const env = windowed(age, gestureDuration[gesture])
  if (gesture === 'pet') {
    pose.squash = age < .09 ? -.11 * Math.sin(age / .09 * Math.PI) : age < .38 ? .07 * Math.sin((age - .09) / .29 * Math.PI) : -.025 * Math.sin((age - .38) / .34 * Math.PI)
    pose.lift = age >= .07 && age < .43 ? Math.sin((age - .07) / .36 * Math.PI) * .26 : 0
    pose.tilt = Math.sin(age * 13) * .07 * env
    pose.squint = .48 * env; pose.ears = .16 * env
  } else if (gesture === 'wave') {
    pose.paw = windowed(age, 1.6, .22, .3)
    pose.wave = Math.sin(Math.max(0, age - .2) * 17) * .25 * pose.paw
    pose.tilt = -.13 * env; pose.ears = .06 * env
  } else if (gesture === 'growl') {
    pose.mouth = windowed(age, 1.05, .12, .28) * (.84 + Math.sin(age * 35) * .06)
    pose.lean = -.09 * env; pose.ears = -.2 * env
    pose.tilt = Math.sin(age * 29) * .018 * env
  } else if (gesture === 'nuzzle') {
    pose.tilt = Math.sin(age * 5.2) * .23 * env
    pose.squint = .76 * env; pose.lean = -.09 * env; pose.paw = .32 * env; pose.ears = .12 * env
  } else if (gesture === 'peek') {
    pose.tilt = -.2 * env; pose.paw = .15 * env; pose.lean = -.045 * env
  } else {
    pose.mouth = .95 * windowed(age, 2, .6, .5)
    pose.squint = .87 * env; pose.lean = -.16 * env; pose.ears = -.08 * env
  }
  return pose
}

/** Quick asymmetric closure and a more leisurely opening, with an occasional double blink. */
export function blinkAmount(age: number, double = false) {
  const one = (t: number) => t < 0 || t > .22 ? 0 : t < .065 ? smooth(t / .065) : 1 - smooth((t - .065) / .155)
  return Math.max(one(age), double ? one(age - .31) : 0)
}

// The best video encoder this machine really has. Being compiled into ffmpeg proves nothing (no such chip, no driver, an
// old driver, a virtual machine), so each is tried on a few frames, once.
import { execFile } from 'node:child_process'
import { encodersFor, SOFTWARE, type Encoder } from '../shared/encoders'
import { FFMPEG } from './media'

const works = (e: Encoder) => new Promise<boolean>(ok => {
  execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-frames:v', '5', ...e.flags, '-f', 'null', '-'],
    { timeout: 10_000, windowsHide: true }, err => ok(!err))
})

let found: Promise<Encoder> | undefined
let known = SOFTWARE

export const videoEncoder = () => found ??= (async () => {
  for (const e of encodersFor(process.platform)) if (e === SOFTWARE || await works(e)) { console.info(`Video encoder: ${e.name}`); return known = e }
  return SOFTWARE
})()

/** What the agent should encode with: as far as is known right now (the search runs at startup). */
export const encoderNow = () => known

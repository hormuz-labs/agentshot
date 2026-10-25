// Just enough of Electron for main-process modules to run under Vitest. userData is a fresh temp folder per run.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'agentshot-test-'))
export const app = {
  isPackaged: false,
  getPath: (name: string) => (name === 'userData' ? userData : join(userData, name)),
  getVersion: () => '0.0.0-test',
}
export const safeStorage = {
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
}
export default { app, safeStorage }

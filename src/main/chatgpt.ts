import { app, safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChatGPTAuth, type ChatGPTStore } from './chatgpt-auth'

export const chatGPTAvailable = () => !process.argv.includes('--worker') && process.env.MANUL_WORKER !== '1' &&
  safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
let auth: ChatGPTAuth | undefined
/** Lazy: never read desktop subscription credentials in worker mode. */
export function chatGPT() {
  if (!chatGPTAvailable()) throw new Error('ChatGPT sign-in requires a local desktop with secure keychain storage.')
  if (!auth) {
    const file = join(app.getPath('userData'), 'chatgpt.enc')
    auth = new ChatGPTAuth({
      read: () => {
        if (!existsSync(file)) return undefined
        // Fail closed on keychain/storage errors rather than silently replacing registrations.
        return JSON.parse(safeStorage.decryptString(readFileSync(file))) as ChatGPTStore
      },
      write: state => {
        if (!chatGPTAvailable()) throw new Error('Secure keychain storage is unavailable.')
        const temp = `${file}.${process.pid}.tmp`
        writeFileSync(temp, safeStorage.encryptString(JSON.stringify(state)), { mode: 0o600 })
        chmodSync(temp, 0o600)
        renameSync(temp, file)
      },
    })
  }
  return auth
}
export const chatGPTStatus = () => chatGPTAvailable() ? chatGPT().status() : { available: false, accounts: [] }

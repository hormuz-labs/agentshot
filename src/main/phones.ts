// Paired phones and this Mac's id, in <userData>/phones.json. Each phone's key is encrypted with the OS keychain
// (Electron safeStorage), like the API keys; the renderer only ever sees names and dates.
import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId } from '../shared/remote'
import type { Device, DeviceStore } from './remote'
import type { PairedPhone } from '../shared/types'

type Saved = { mac: string; devices: (Omit<Device, 'key'> & { key: string })[] }

export class Phones implements DeviceStore {
  private file = join(app.getPath('userData'), 'phones.json')
  private saved: Saved
  private keys = new Map<string, string>() // device id → key, decrypted once
  mac: { id: string; name: string }

  constructor(name: string) {
    try { this.saved = JSON.parse(readFileSync(this.file, 'utf8')) } catch { this.saved = { mac: newId(), devices: [] } }
    for (const d of this.saved.devices) {
      try { this.keys.set(d.id, safeStorage.decryptString(Buffer.from(d.key, 'base64'))) } catch { /* keychain refused: that phone pairs again */ }
    }
    this.mac = { id: this.saved.mac, name }
    this.save()
  }

  get(id: string): Device | undefined {
    const d = this.saved.devices.find(x => x.id === id)
    const key = this.keys.get(id)
    return d && key ? { ...d, key } : undefined
  }

  add(d: Device) {
    this.keys.set(d.id, d.key)
    this.saved.devices.push({ ...d, key: safeStorage.encryptString(d.key).toString('base64') })
    this.save()
  }

  seen(id: string) {
    const d = this.saved.devices.find(x => x.id === id)
    if (d) { d.lastSeen = Date.now(); this.save() }
  }

  forget(id: string) {
    this.saved.devices = this.saved.devices.filter(d => d.id !== id)
    this.keys.delete(id)
    this.save()
  }

  list(): PairedPhone[] {
    return this.saved.devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen }))
  }

  private save() { writeFileSync(this.file, JSON.stringify(this.saved, null, 1), { mode: 0o600 }) }
}

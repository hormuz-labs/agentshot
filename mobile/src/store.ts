// The paired Mac (its key included) in the phone's keychain.
import * as SecureStore from 'expo-secure-store'
import type { Mac } from './mac'

const KEY = 'manul.mac'

export async function loadMac(): Promise<Mac | null> {
  try { return JSON.parse((await SecureStore.getItemAsync(KEY)) || 'null') } catch { return null }
}
export const saveMac = (m: Mac) => SecureStore.setItemAsync(KEY, JSON.stringify(m))
export const forgetMac = () => SecureStore.deleteItemAsync(KEY)

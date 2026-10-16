// What the shared protocol code needs from the platform: crypto.getRandomValues (nonces and keys, @noble/ciphers).
import { getRandomValues } from 'expo-crypto'

const g = globalThis as { crypto?: { getRandomValues?: unknown } }
if (!g.crypto?.getRandomValues) g.crypto = { ...g.crypto, getRandomValues }

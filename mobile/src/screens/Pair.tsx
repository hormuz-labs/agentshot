// Pair with a Mac: scan the QR code in Manul → Settings → Phone, open its link, or paste it (the simulator has no camera).
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Device from 'expo-device'
import * as Linking from 'expo-linking'
import { fetch } from 'expo/fetch'
import { readPairingUrl } from '../../../src/shared/remote'
import { pair, type Mac } from '../mac'
import { useTheme } from '../theme'

export function Pair({ onPaired }: { onPaired(m: Mac): Promise<void> }) {
  const t = useTheme()
  const [permission, requestPermission] = useCameraPermissions()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tried = useRef(new Set<string>()) // the camera sees the same code many times a second
  const opened = Linking.useLinkingURL()

  const tryLink = async (url: string) => {
    if (busy || tried.current.has(url)) return
    tried.current.add(url)
    const code = readPairingUrl(url.trim())
    if (!code) { setError("That isn't a Manul pairing code, or it has expired. Make a new one on your Mac."); return }
    setBusy(true)
    setError(null)
    try {
      await onPaired(await pair(code, Device.deviceName || Device.modelName || 'Phone', fetch as never))
    } catch (e) {
      setError((e as Error).message)
      tried.current.delete(url) // the Wi-Fi may come back: let them try the same code again
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { if (opened?.startsWith('manul://pair')) void tryLink(opened) }, [opened])

  return (
    <View style={[s.wrap, { backgroundColor: t.bg }]}>
      <Text style={[s.title, { color: t.fg }]}>Pair with your Mac</Text>
      <Text style={[s.body, { color: t.dim }]}>
        On your Mac, open Manul, go to Settings → Phone and turn on “Let my phone connect”. Then scan the code it shows.
      </Text>

      <View style={[s.camera, { backgroundColor: t.raised, borderColor: t.line }]}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : r => { if (r.data.startsWith('manul://pair')) void tryLink(r.data) }} />
        ) : (
          <Pressable onPress={requestPermission} style={[s.button, { backgroundColor: t.amber }]}>
            <Text style={[s.buttonText, { color: t.onAmber }]}>{permission?.canAskAgain === false ? 'Allow the camera in Settings' : 'Use the camera'}</Text>
          </Pressable>
        )}
        {busy && <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: '#0008' }]}><ActivityIndicator color="#fff" /></View>}
      </View>

      <Text style={[s.small, { color: t.faint }]}>Or paste the pairing link</Text>
      <View style={s.row}>
        <TextInput value={link} onChangeText={setLink} placeholder="manul://pair#…" placeholderTextColor={t.faint} autoCapitalize="none" autoCorrect={false}
          style={[s.input, { color: t.fg, backgroundColor: t.surface, borderColor: t.line }]} />
        <Pressable disabled={!link || busy} onPress={() => { tried.current.delete(link); void tryLink(link) }}
          style={[s.button, { backgroundColor: t.amber, opacity: !link || busy ? 0.4 : 1 }]}>
          <Text style={[s.buttonText, { color: t.onAmber }]}>Pair</Text>
        </Pressable>
      </View>
      {error && <Text style={[s.error, { color: t.bad }]}>{error}</Text>}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 14 },
  title: { fontSize: 26, fontWeight: '600', marginTop: 12 },
  body: { fontSize: 15, lineHeight: 21 },
  camera: { aspectRatio: 1, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  small: { fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, height: 42, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 14 },
  button: { height: 42, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 20 },
})

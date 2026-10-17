// Film something for the project: the camera, full screen, until the shutter stops it. The take goes to the outbox.
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
/** "Phone 17 Oct 14.32.mov": the take's name in the project */
const takeName = (d = new Date()) =>
  `Phone ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}.mov`

export function Record({ onRecorded, onClose }: { onRecorded(uri: string, name: string): void; onClose(): void }) {
  const insets = useSafeAreaInsets()
  const camera = useRef<CameraView>(null)
  const [cam, askCam] = useCameraPermissions()
  const [mic, askMic] = useMicrophonePermissions()
  const [ready, setReady] = useState(false)
  const [facing, setFacing] = useState<'back' | 'front'>('back')
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const shutter = async () => {
    if (recording) { camera.current?.stopRecording(); return }
    setError(null)
    setSeconds(0)
    setRecording(true)
    try {
      const r = await camera.current?.recordAsync()
      if (r?.uri) onRecorded(r.uri, takeName())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRecording(false)
    }
  }

  if (!cam?.granted || !mic?.granted) {
    const denied = cam?.canAskAgain === false || mic?.canAskAgain === false
    return (
      <View style={[s.wrap, s.center, { paddingTop: insets.top }]}>
        <Text style={s.ask}>Manul needs the camera and the microphone to film for your project.</Text>
        <Pressable onPress={async () => { if (!cam?.granted) await askCam(); if (!mic?.granted) await askMic() }} style={s.allow}>
          <Text style={s.allowText}>{denied ? 'Allow them in Settings' : 'Allow'}</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={12}><Text style={s.link}>Cancel</Text></Pressable>
      </View>
    )
  }

  return (
    <View style={s.wrap}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} mode="video" facing={facing} onCameraReady={() => setReady(true)}
        onRecordingProgress={p => setSeconds(p.duration)} />
      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onClose} disabled={recording} hitSlop={12}><Text style={[s.link, recording && { opacity: 0.3 }]}>Cancel</Text></Pressable>
        <Text style={[s.clock, recording && s.live]}>{clock(seconds)}</Text>
        <Pressable onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} disabled={recording} hitSlop={12}>
          <Text style={[s.link, recording && { opacity: 0.3 }]}>Flip</Text>
        </Pressable>
      </View>
      {error && <Text style={s.error}>{error}</Text>}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable onPress={shutter} disabled={!ready} accessibilityLabel={recording ? 'Stop recording' : 'Record'} style={[s.ring, !ready && { opacity: 0.4 }]}>
          <View style={recording ? s.stop : s.dot} />
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32 },
  ask: { color: '#fff', fontSize: 17, lineHeight: 24, textAlign: 'center' },
  allow: { height: 44, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#f2a541', alignItems: 'center', justifyContent: 'center' },
  allowText: { color: '#1a1208', fontSize: 16, fontWeight: '600' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  link: { color: '#fff', fontSize: 17 },
  clock: { color: '#fff', fontSize: 17, fontVariant: ['tabular-nums'], paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  live: { backgroundColor: '#c2412f' },
  error: { color: '#fff', backgroundColor: '#0009', margin: 20, padding: 12, borderRadius: 10, overflow: 'hidden', fontSize: 15 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  ring: { width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#e5483a' },
  stop: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#e5483a' },
})

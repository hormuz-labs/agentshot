// Manul on the phone: pair with your Mac, pick a project, talk to its agent, send it footage. The Mac does the work;
// the phone is a window onto it (see ROADMAP.md, phase 4, and src/shared/remote.ts for the protocol).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as Linking from 'expo-linking'
import { fetch } from 'expo/fetch'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { RemoteProject } from '../src/shared/remote'
import { discard, takeShared, type Kept } from './src/files'
import { MacClient, type Mac } from './src/mac'
import { outbox } from './src/outbox'
import { forgetMac, loadMac, saveMac } from './src/store'
import { Pair } from './src/screens/Pair'
import { Projects } from './src/screens/Projects'
import { Chat } from './src/screens/Chat'
import { Share } from './src/screens/Share'
import { useTheme } from './src/theme'

export default function App() {
  const t = useTheme()
  const [mac, setMac] = useState<Mac | null | undefined>(undefined) // undefined: still reading the keychain
  const [project, setProject] = useState<RemoteProject | null>(null)
  const [shared, setShared] = useState<Kept[]>([])
  useEffect(() => { loadMac().then(setMac) }, [])
  const client = useMemo(() => (mac ? new MacClient(mac, fetch as never) : null), [mac])
  useEffect(() => { outbox.use(client) }, [client])

  // what the share extension left: on launch, when it opens the app (manul://share), and coming back to the app
  const link = Linking.useLinkingURL()
  const collect = useCallback(() => {
    try { const got = takeShared(); if (got.length) setShared(s => [...s, ...got]) } catch (e) { console.warn('share', e) }
  }, [])
  useEffect(collect, [collect, link])
  useEffect(() => { const sub = AppState.addEventListener('change', s => { if (s === 'active') collect() }); return () => sub.remove() }, [collect])

  const paired = async (m: Mac) => { await saveMac(m); setMac(m) }
  const unpair = async () => { await forgetMac(); outbox.forget(); setProject(null); setMac(null) }
  const sendShared = (p: RemoteProject) => { outbox.add(p, shared); setShared([]); setProject(p) }
  const dropShared = () => { shared.forEach(discard); setShared([]) }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        {mac === null && <Pair onPaired={paired} />}
        {client && shared.length > 0 && <Share client={client} files={shared} onSend={sendShared} onCancel={dropShared} />}
        {client && !shared.length && !project && <Projects client={client} onOpen={setProject} onUnpair={unpair} />}
        {client && !shared.length && project && <Chat client={client} project={project} onBack={() => setProject(null)} />}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

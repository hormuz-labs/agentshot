// Manul on the phone: pair with your Mac, pick a project, talk to its agent. The Mac does the work; the phone is a
// window onto it (see ROADMAP.md, phase 4, and src/shared/remote.ts for the protocol).
import { useEffect, useMemo, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { fetch } from 'expo/fetch'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { RemoteProject } from '../src/shared/remote'
import { MacClient, type Mac } from './src/mac'
import { forgetMac, loadMac, saveMac } from './src/store'
import { Pair } from './src/screens/Pair'
import { Projects } from './src/screens/Projects'
import { Chat } from './src/screens/Chat'
import { useTheme } from './src/theme'

export default function App() {
  const t = useTheme()
  const [mac, setMac] = useState<Mac | null | undefined>(undefined) // undefined: still reading the keychain
  const [project, setProject] = useState<RemoteProject | null>(null)
  useEffect(() => { loadMac().then(setMac) }, [])
  const client = useMemo(() => (mac ? new MacClient(mac, fetch as never) : null), [mac])

  const paired = async (m: Mac) => { await saveMac(m); setMac(m) }
  const unpair = async () => { await forgetMac(); setProject(null); setMac(null) }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        {mac === null && <Pair onPaired={paired} />}
        {client && !project && <Projects client={client} onOpen={setProject} onUnpair={unpair} />}
        {client && project && <Chat client={client} project={project} onBack={() => setProject(null)} />}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

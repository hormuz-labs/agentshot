// The Mac's recent projects: pick one to talk to its agent.
import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import type { RemoteProject } from '../../../src/shared/remote'
import { MacError, type MacClient } from '../mac'
import { useTheme } from '../theme'

const when = (t: number) => {
  const d = Math.round((Date.now() - t) / 86_400_000)
  return d < 1 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString()
}

export function Projects({ client, onOpen, onUnpair }: { client: MacClient; onOpen(p: RemoteProject): void; onUnpair(): void }) {
  const t = useTheme()
  const [projects, setProjects] = useState<RemoteProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setProjects(await client.projects())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      if (e instanceof MacError && e.status === 401) onUnpair()
    } finally {
      setRefreshing(false)
    }
  }, [client, onUnpair])
  useEffect(() => { void load() }, [load])

  const unpair = () => Alert.alert(`Unpair ${client.mac.name}?`, 'To use it again, scan a new code from Manul → Settings → Phone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unpair', style: 'destructive', onPress: onUnpair },
  ])

  return (
    <View style={[s.wrap, { backgroundColor: t.bg }]}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={[s.small, { color: t.faint }]}>{client.mac.name}</Text>
          <Text style={[s.title, { color: t.fg }]}>Projects</Text>
        </View>
        <Pressable onPress={unpair} hitSlop={12}><Text style={[s.link, { color: t.dim }]}>Unpair</Text></Pressable>
      </View>
      {error && <Text style={[s.banner, { color: t.bad, backgroundColor: t.raised }]}>{error}</Text>}
      <FlatList
        data={projects || []}
        keyExtractor={p => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={t.faint} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={projects ? <Text style={[s.empty, { color: t.dim }]}>No projects yet. Start one on your Mac.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [s.row, { borderColor: t.line, backgroundColor: pressed ? t.raised : t.surface }]}>
            <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[s.small, { color: t.faint }]}>{when(item.openedAt)}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 12, paddingBottom: 14 },
  title: { fontSize: 28, fontWeight: '600' },
  small: { fontSize: 13 },
  link: { fontSize: 15 },
  banner: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 10, marginBottom: 10, overflow: 'hidden' },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 48 },
  row: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8, gap: 4 },
  name: { fontSize: 16, fontWeight: '500' },
})

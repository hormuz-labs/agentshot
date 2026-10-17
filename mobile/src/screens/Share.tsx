// "Send to Manul" from the share sheet: the extension left the files with the app; pick the project they go into.
import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { RemoteProject } from '../../../src/shared/remote'
import type { Kept } from '../files'
import type { MacClient } from '../mac'
import { useTheme } from '../theme'

const mb = (n: number) => `${Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`

export function Share({ client, files, onSend, onCancel }: { client: MacClient; files: Kept[]; onSend(p: RemoteProject): void; onCancel(): void }) {
  const t = useTheme()
  const [projects, setProjects] = useState<RemoteProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { client.projects().then(setProjects, e => setError((e as Error).message)) }, [client])
  const total = files.reduce((n, f) => n + f.size, 0)

  return (
    <View style={[s.wrap, { backgroundColor: t.bg }]}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={[s.small, { color: t.faint }]}>{files.length === 1 ? files[0].name : `${files.length} files`} · {mb(total)}</Text>
          <Text style={[s.title, { color: t.fg }]}>Send to which project?</Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={12}><Text style={[s.link, { color: t.dim }]}>Cancel</Text></Pressable>
      </View>
      <Text style={[s.body, { color: t.dim }]}>It goes straight to {client.mac.name} over your Wi-Fi, into the project's files, where the agent can use it.</Text>
      {error && <Text style={[s.banner, { color: t.bad, backgroundColor: t.raised }]}>{error}</Text>}
      <FlatList
        data={projects || []}
        keyExtractor={p => p.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={projects ? <Text style={[s.empty, { color: t.dim }]}>No projects yet. Start one on your Mac.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable onPress={() => onSend(item)} style={({ pressed }) => [s.row, { borderColor: t.line, backgroundColor: pressed ? t.raised : t.surface }]}>
            <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>{item.title}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  small: { fontSize: 13 },
  link: { fontSize: 15 },
  banner: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 10, marginBottom: 10, overflow: 'hidden' },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 48 },
  row: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: '500' },
})

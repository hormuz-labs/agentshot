// Talk to the agent about one project: the same conversation the Mac's agent panel shows, live, both ways. Footage
// filmed here or picked from the library goes into the project, and rides along with the next message.
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import type { Message } from '@ag-ui/core'
import { emptyAgentState, reduce, resultsOf, type AgentState } from '../../../src/shared/agui-state'
import { splitAttached } from '../../../src/shared/attached'
import type { RemoteProject } from '../../../src/shared/remote'
import type { MacClient } from '../mac'
import { outbox, useOutbox, type Item as Outgoing } from '../outbox'
import { useTheme, type Theme } from '../theme'
import { Record } from './Record'

type Item =
  | { key: string; kind: 'user'; text: string; files: string[]; note?: string }
  | { key: string; kind: 'editor'; text: string }
  | { key: string; kind: 'assistant'; text: string }
  | { key: string; kind: 'tool'; name: string; state: 'pending' | 'running' | 'done' | 'failed' }

// how the Mac marks a message (src/main/index.ts sendToAgent), shown the way its agent panel shows them
const NOTE = /^\[note \S+ ([^\]]*)\] /
const EDITOR = /^\[editor\] /

/** A tool's name as a phrase: cut_video → "Cut video". */
const phrase = (name: string) => { const s = name.replace(/[_-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1) }

/** What a person reads: what they and the agent said, and one line per tool the agent used. */
function itemsOf(st: AgentState): Item[] {
  const results = resultsOf(st.messages)
  const items: Item[] = []
  for (const m of st.messages as (Message & { toolCalls?: { id: string; function: { name: string } }[] })[]) {
    if (m.role === 'user') {
      const text = String(m.content ?? '')
      if (EDITOR.test(text)) { items.push({ key: m.id, kind: 'editor', text: text.replace(EDITOR, '') }); continue }
      const note = NOTE.exec(text)?.[1].replace(/^@ /, '').replace(/, box [\d.,]+/, ' · box')
      const msg = splitAttached(text.replace(NOTE, ''))
      items.push({ key: m.id, kind: 'user', text: msg.text.trim(), files: msg.files.map(f => f.split('/').pop()!).concat(msg.more ? [`+${msg.more} more`] : []), note })
    }
    if (m.role !== 'assistant') continue
    if (m.content) items.push({ key: m.id, kind: 'assistant', text: String(m.content) })
    for (const c of m.toolCalls || []) {
      const r = results[c.id]
      items.push({ key: c.id, kind: 'tool', name: c.function.name, state: r ? (r.error ? 'failed' : 'done') : st.running.includes(c.id) ? 'running' : 'pending' })
    }
  }
  for (const [id, p] of Object.entries(st.pending)) items.push({ key: id, kind: 'tool', name: p.name, state: 'pending' })
  if (st.streaming?.text) items.push({ key: st.streaming.id, kind: 'assistant', text: st.streaming.text })
  return items
}

export function Chat({ client, project, onBack }: { client: MacClient; project: RemoteProject; onBack(): void }) {
  const t = useTheme()
  const [st, setSt] = useState<AgentState>(emptyAgentState)
  const [link, setLink] = useState<{ status: string; error?: string }>({ status: 'connecting' })
  const [text, setText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [adding, setAdding] = useState(false)
  const [filming, setFilming] = useState(false)
  const uploads = useOutbox(project.id)
  const ready = uploads.filter(u => u.state === 'done')

  useEffect(() => client.follow(project.id, {
    open: () => setSt(emptyAgentState()), // the Mac replays the whole conversation next
    event: e => setSt(prev => reduce(prev, e as never)),
    status: (status, error) => setLink({ status, error }),
  }), [client, project.id])

  const items = useMemo(() => itemsOf(st).reverse(), [st]) // newest first: the list is inverted

  const send = async () => {
    const msg = text.trim()
    if ((!msg && !ready.length) || sending) return
    setSending(true)
    setSendError(null)
    try {
      await client.send(project.id, msg, ready.flatMap(u => u.files || []))
      outbox.sent(ready.map(u => u.id))
      setText('')
    } catch (e) { setSendError((e as Error).message) } finally { setSending(false) }
  }

  const pick = async () => {
    setAdding(false)
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      allowsMultipleSelection: true,
      // the original, as filmed (HEVC and all): the Mac's ffmpeg reads it, and transcoding on the phone takes ages
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    })
    if (r.canceled) return
    outbox.add(project, r.assets.map(a => ({ uri: a.uri, name: a.fileName || a.uri.split('/').pop() || 'clip.mov', file: a.file })))
  }
  const canSend = (!!text.trim() || ready.length > 0) && !sending

  return (
    <KeyboardAvoidingView style={[s.wrap, { backgroundColor: t.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.header, { borderColor: t.line }]}>
        <Pressable onPress={onBack} hitSlop={12}><Text style={[s.back, { color: t.amber }]}>‹ Projects</Text></Pressable>
        <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>{project.title}</Text>
        <View style={[s.dot, { backgroundColor: link.status === 'live' ? (st.busy ? t.amber : t.ok) : t.faint }]} />
      </View>
      {link.status !== 'live' && (
        <Text style={[s.banner, { color: link.status === 'unpaired' ? t.bad : t.dim, backgroundColor: t.raised }]}>
          {link.status === 'connecting' ? `Connecting to ${client.mac.name}…` : link.error || `Lost ${client.mac.name}. Trying again…`}
        </Text>
      )}
      <FlatList
        inverted
        data={items}
        keyExtractor={i => i.key}
        contentContainerStyle={s.list}
        ListHeaderComponent={st.busy ? <View style={s.working}><ActivityIndicator size="small" color={t.faint} /><Text style={[s.small, { color: t.faint }]}>Working…</Text></View> : undefined}
        ListEmptyComponent={link.status === 'live' ? <Text style={[s.empty, { color: t.dim }]}>Say what you want done to this project.</Text> : undefined}
        renderItem={({ item }) => <Row item={item} t={t} />}
      />
      {(st.error || sendError) && <Text style={[s.banner, { color: t.bad, backgroundColor: t.raised }]}>{sendError || st.error}</Text>}
      {uploads.length > 0 && <View style={s.uploads}>{uploads.map(u => <Upload key={u.id} u={u} t={t} />)}</View>}
      {adding && (
        <View style={s.adding}>
          {Platform.OS !== 'web' && (
            <Pressable onPress={() => { setAdding(false); setFilming(true) }} style={[s.choice, { backgroundColor: t.surface, borderColor: t.line }]}>
              <Text style={[s.buttonText, { color: t.fg }]}>Record video</Text>
            </Pressable>
          )}
          <Pressable onPress={pick} style={[s.choice, { backgroundColor: t.surface, borderColor: t.line }]}>
            <Text style={[s.buttonText, { color: t.fg }]}>From your library</Text>
          </Pressable>
        </View>
      )}
      <View style={[s.composer, { borderColor: t.line, backgroundColor: t.surface }]}>
        <Pressable onPress={() => setAdding(a => !a)} accessibilityLabel="Add footage" style={[s.button, s.plus, { backgroundColor: adding ? t.amberSoft : t.raised }]}>
          <Text style={[s.plusText, { color: adding ? t.amber : t.fg }]}>+</Text>
        </Pressable>
        <TextInput value={text} onChangeText={setText} placeholder={ready.length ? 'What should it do with this?' : 'Ask for an edit…'} placeholderTextColor={t.faint} multiline
          style={[s.input, { color: t.fg }]} />
        {st.busy && (
          <Pressable onPress={() => client.stop(project.id).catch(e => setSendError((e as Error).message))} style={[s.button, { backgroundColor: t.raised }]}>
            <Text style={[s.buttonText, { color: t.fg }]}>Stop</Text>
          </Pressable>
        )}
        <Pressable onPress={send} disabled={!canSend} style={[s.button, { backgroundColor: t.amber, opacity: canSend ? 1 : 0.4 }]}>
          <Text style={[s.buttonText, { color: t.onAmber }]}>Send</Text>
        </Pressable>
      </View>
      <Modal visible={filming} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFilming(false)}>
        <Record onClose={() => setFilming(false)} onRecorded={(uri, name) => { setFilming(false); outbox.add(project, [{ uri, name }]) }} />
      </Modal>
    </KeyboardAvoidingView>
  )
}

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`)

/** A file on its way to the Mac, or in the project and waiting to go with the next message. */
function Upload({ u, t }: { u: Outgoing; t: Theme }) {
  const part = u.size ? u.received / u.size : 0
  const status =
    u.state === 'done' ? 'In the project · goes with your next message'
      : u.state === 'failed' ? u.error || 'Didn’t send.'
        : u.state === 'waiting' ? 'Waiting…'
          : `${mb(u.received)} of ${mb(u.size)}`
  return (
    <View style={[s.upload, { backgroundColor: t.surface, borderColor: t.line }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.small, { color: t.fg }]} numberOfLines={1}>{u.name}</Text>
        <Text style={[s.tiny, { color: u.state === 'failed' ? t.bad : t.faint }]} numberOfLines={2}>{status}</Text>
        {u.state !== 'done' && u.state !== 'failed' && (
          <View style={[s.bar, { backgroundColor: t.raised }]}><View style={[s.fill, { backgroundColor: t.amber, width: `${Math.round(part * 100)}%` }]} /></View>
        )}
      </View>
      {u.state === 'failed' && <Pressable onPress={() => outbox.retry(u.id)} hitSlop={8}><Text style={[s.small, { color: t.amber }]}>Retry</Text></Pressable>}
      <Pressable onPress={() => outbox.remove(u.id)} hitSlop={8} accessibilityLabel={u.state === 'done' ? 'Don’t attach' : 'Stop sending'}>
        <Text style={[s.small, { color: t.faint }]}>✕</Text>
      </Pressable>
    </View>
  )
}

function Row({ item, t }: { item: Item; t: Theme }) {
  if (item.kind === 'user') {
    return (
      <View style={[s.bubble, { backgroundColor: t.amberSoft }]}>
        {item.note && <Text style={[s.small, { color: t.dim, marginBottom: 2 }]}>Note · {item.note}</Text>}
        {!!item.text && <Text style={[s.text, { color: t.fg }]}>{item.text}</Text>}
        {item.files.length > 0 && <Text style={[s.small, { color: t.dim, marginTop: item.text ? 4 : 0 }]}>{item.files.join(' · ')}</Text>}
      </View>
    )
  }
  if (item.kind === 'editor') return <Text style={[s.small, { color: t.faint, textAlign: 'center' }]}>{item.text}</Text>
  if (item.kind === 'assistant') return <Text style={[s.text, s.reply, { color: t.fg }]}>{item.text}</Text>
  return (
    <View style={s.tool}>
      {item.state === 'running' || item.state === 'pending' ? <ActivityIndicator size="small" color={t.faint} /> : <Text style={{ color: item.state === 'failed' ? t.bad : t.ok }}>{item.state === 'failed' ? '✕' : '✓'}</Text>}
      <Text style={[s.small, { color: item.state === 'failed' ? t.bad : t.dim }]}>{phrase(item.name)}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { fontSize: 16 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { fontSize: 14, lineHeight: 20, padding: 10, marginHorizontal: 12, marginTop: 8, borderRadius: 10, overflow: 'hidden' },
  list: { padding: 16, gap: 10 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 48, transform: [{ scaleY: -1 }] },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  reply: { alignSelf: 'flex-start', maxWidth: '95%' },
  text: { fontSize: 16, lineHeight: 23 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  small: { fontSize: 14 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 12, padding: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, fontSize: 16, maxHeight: 140, paddingHorizontal: 6, paddingVertical: 8 },
  button: { height: 36, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
  plus: { width: 36, paddingHorizontal: 0 },
  plusText: { fontSize: 22, lineHeight: 24, fontWeight: '400' },
  adding: { flexDirection: 'row', gap: 8, marginHorizontal: 12, marginTop: 8 },
  choice: { flex: 1, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  uploads: { gap: 6, marginHorizontal: 12, marginTop: 8 },
  upload: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  tiny: { fontSize: 12, lineHeight: 16 },
  bar: { height: 3, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  fill: { height: 3 },
})

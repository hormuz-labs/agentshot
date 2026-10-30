// An explicit network surface, independent of Electron's broader IPC surface.
import { z } from 'zod'
const text = z.string().max(100_000)
const id = z.string().min(1).max(1024)
const dir = z.string().min(1).max(4096)
const rel = z.string().min(1).max(4096).refine(s => !s.startsWith('/') && !s.includes('\\') && !s.split('/').some(p => p === '..' || p.startsWith('.')) && !s.includes('\0') && !/^[a-z]:/i.test(s))
const num = z.number().finite()
const time = num.min(0).max(86400)
const model = z.object({ provider: id, modelId: id }).strict()
const anchor = z.object({ t0: time, t1: time.optional(), box: z.object({ x: num.min(0).max(1), y: num.min(0).max(1), w: num.positive().max(1), h: num.positive().max(1) }).strict().refine(b => b.x + b.w <= 1.001 && b.y + b.h <= 1.001).optional(), clip: z.object({ id: id.regex(/^[a-z0-9][a-z0-9-]{0,40}$/), element: id.optional() }).strict().optional() }).strict().refine(a => a.t1 === undefined || a.t1 >= a.t0)
const mix = z.object({ filmDb: num.min(-40).max(12), music: z.object({ src: rel, db: num.min(-40).max(12), duckDb: num.min(0).max(40) }).strict().optional() }).strict()
const edit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('split'), at: time }).strict(),
  z.object({ op: z.literal('cut'), from: time, to: time }).strict(),
  z.object({ op: z.literal('delete'), ids: z.array(id).max(1000) }).strict(),
  z.object({ op: z.literal('move'), id, before: id.optional() }).strict(),
  z.object({ op: z.literal('trim'), id, in: time.optional(), out: time.optional() }).strict(),
  z.object({ op: z.literal('level'), ids: z.array(id).max(1000), db: num.min(-40).max(12).optional(), muted: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('insert'), at: time, src: rel, in: time, out: time }).strict(),
  z.object({ op: z.literal('mix'), mix }).strict(),
])
export const mobileSchemas = {
  'app:info': z.tuple([]), 'project:recent': z.tuple([]), 'gallery:list': z.tuple([]),
  'project:open': z.tuple([dir]), 'project:delete': z.tuple([dir]),
  // a project as it's saved, without opening it (no agent, no proxies made): for the phone to keep ahead of a tap
  'project:peek': z.tuple([dir]),
  'project:close': z.tuple([dir]),
  'project:createMotion': z.tuple([z.object({ title: text.optional(), aspect: z.enum(['16:9', '9:16', '1:1']), length: time.optional(), example: id.optional(), walkthrough: z.boolean().optional(), model: model.optional() }).strict()]),
  'project:decide': z.tuple([dir, z.boolean()]), 'project:current': z.tuple([dir, id]), 'project:removeFiles': z.tuple([dir, z.array(rel).max(1000)]),
  'agent:ready': z.tuple([]), 'agent:attach': z.tuple([dir]), 'agent:stop': z.tuple([dir]),
  'agent:send': z.tuple([dir, z.object({ text, anchor: anchor.optional(), files: z.array(rel).max(100).optional(), notes: z.array(z.object({ text, anchor: anchor.optional() }).strict()).min(1).max(20).optional() }).strict()]),
  'agent:models': z.tuple([dir]).or(z.tuple([])), 'agent:setModel': z.tuple([dir, model.nullable()]),
  'agent:newConversation': z.tuple([dir]), 'agent:switch': z.tuple([dir, id]), 'agent:rename': z.tuple([dir, id, text]),
  'timeline:edit': z.tuple([dir, z.array(edit).min(1).max(1000)]), 'timeline:undo': z.tuple([dir, z.boolean()]), 'timeline:render': z.tuple([dir]),
  'history:log': z.tuple([dir]), 'history:restore': z.tuple([dir, id]),
  'transcript:get': z.tuple([dir, rel, z.boolean()]), 'preview:prepare': z.tuple([dir, rel]),
  'mobile:export': z.tuple([dir, z.object({ preset: z.enum(['original', 'landscape', 'vertical', 'square']), fit: z.enum(['pad', 'crop']), captions: z.enum(['none', 'burn', 'srt']) }).strict()]),
  'clip:overlay': z.tuple([dir, id, time, text]),
  'clip:save': z.tuple([dir, id, text, text, time, z.boolean().optional()]),
  'clip:insert': z.tuple([dir, id, time, text]),
  'clip:move': z.tuple([dir, id, id, num, num]),
  'clip:render': z.tuple([dir, id]),
  'media:thumbnails': z.tuple([dir, rel, z.number().int().min(1).max(120), time.optional(), time.optional()]),
  'demo:cancel': z.tuple([dir]),
  'demo:create': z.tuple([dir, z.record(z.string(), z.unknown())]),
  'mix:speech': z.tuple([dir, id.optional()]),
  'export:run': z.tuple([dir, z.object({ preset: z.enum(['original', 'landscape', 'vertical', 'square']), fit: z.enum(['pad', 'crop']).optional(), captions: z.enum(['none', 'burn', 'srt']), captionColor: text.optional() }).strict()]),
  'jobs:list': z.tuple([]), 'consent:list': z.tuple([]), 'consent:answer': z.tuple([id, z.boolean()]),
  'skills:state': z.tuple([]), 'skills:enable': z.tuple([id, z.boolean()]), 'skills:profile': z.tuple([id]), 'skills:newProfile': z.tuple([id]),
  'memory:list': z.tuple([]), 'memory:save': z.tuple([id.regex(/^[a-zA-Z0-9_-]+$/), text, text]), 'memory:forget': z.tuple([id.regex(/^[a-zA-Z0-9_-]+$/)]),
  'keys:list': z.tuple([]), 'keys:set': z.tuple([id, text]), 'providers:list': z.tuple([]),
  'tools:status': z.tuple([]), 'tools:list': z.tuple([]), 'tools:install': z.tuple([id]), 'tools:remove': z.tuple([id]), 'whisper:status': z.tuple([]),
  'account:status': z.tuple([]), 'account:balance': z.tuple([]),
  // the phone hands over the AgentShot account it signed in with (checked with the account service before it is kept)
  'account:adopt': z.tuple([z.object({ key: z.string().min(8).max(512), keyId: id.optional(), email: z.string().max(320).optional() }).strict()]),
  'browser:state': z.tuple([]), 'browser:mode': z.tuple([]), 'browser:set-mode': z.tuple([z.enum(['manul', 'chrome'])]),
  'browser:navigate': z.tuple([z.url().refine(s => /^https?:\/\//.test(s))]),
  'browser:back': z.tuple([]), 'browser:forward': z.tuple([]), 'browser:reload': z.tuple([]), 'browser:new': z.tuple([]),
  'browser:select': z.tuple([z.number().int().positive()]), 'browser:close': z.tuple([z.number().int().positive()]),
} satisfies Record<string, z.ZodType>
export function mobileArgs(method: string, args: unknown): unknown[] {
  if (!Object.hasOwn(mobileSchemas, method)) throw new Error('Unsupported mobile method')
  return (mobileSchemas[method as keyof typeof mobileSchemas] as z.ZodType<unknown[]>).parse(args)
}
export function projectArgument(method: string): boolean {
  return /^(project:(open|peek|close|delete|decide|current|removeFiles)|agent:(attach|stop|send|models|setModel|newConversation|switch|rename)|timeline:|history:|transcript:|preview:|mobile:export|clip:|media:thumbnails|demo:|mix:|export:run)/.test(method)
}

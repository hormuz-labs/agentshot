// A message box at the selection itself: under a box drawn on the picture, or above a range (or a note's moment) on the
// timeline. What's typed goes to the agent with the selection, exactly as from the chat, and shows in the conversation;
// the chat needn't be open.
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, MessageSquareText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function InlineAsk({ label, onSend, onCancel }: {
  /** where it points: "0:03.1–0:05.4", "0:03.1 · box" */
  label: string
  onSend(text: string): void
  onCancel(): void
}) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { input.current?.focus() }, [label])
  const send = () => { const t = text.trim(); if (t) { onSend(t); setText('') } }
  return (
    <div
      data-inline-ask
      // clicks here are the box's own, not the film's (play/pause) or the timeline's (seek)
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      className="no-drag w-[320px] max-w-full cursor-default rounded-xl border border-line bg-surface p-1.5 text-fg shadow-xl shadow-shade"
    >
      <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-0.5 text-[11px] text-amber">
        <MessageSquareText className="size-3" /><span className="flex-1 truncate tabular">{label}</span>
        <button onClick={onCancel} aria-label="Cancel" className="rounded p-0.5 text-faint hover:text-fg"><X className="size-3" /></button>
      </div>
      <div className="flex items-end gap-1">
        <textarea
          ref={input}
          rows={1}
          value={text}
          aria-label="What should change here?"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          }}
          placeholder="What should change here?"
          className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13px] outline-none placeholder:text-faint [field-sizing:content]"
        />
        <Button size="iconSm" variant="primary" className="mb-0.5 rounded-lg" disabled={!text.trim()} onClick={send} aria-label="Send to Manul"><ArrowUp /></Button>
      </div>
      <div className="px-1.5 pb-0.5 text-[10.5px] text-faint">↵ to send · Esc to cancel · it shows in the chat</div>
    </div>
  )
}

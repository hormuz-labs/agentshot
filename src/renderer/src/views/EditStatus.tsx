// On the timeline's header while the edit isn't rendered as a version: saying so, and saving it (Export renders it too).
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'

export function EditStatus({ saving, onSave }: { saving: boolean; onSave(): void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Tip label="The edit plays straight from its pieces. Save it as a version to render it (Export renders it too).">
        <span className="flex items-center gap-1.5 text-[11px] text-amber" data-edited><span className="size-1.5 rounded-full bg-amber" />Edited</span>
      </Tip>
      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" disabled={saving} onClick={onSave}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save as version</Button>
    </div>
  )
}

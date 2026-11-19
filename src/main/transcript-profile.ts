import { createHash } from 'node:crypto'
import { fileRevision } from './transcript-chunks'

/** Shared identity for completed transcripts and resumable chunks. */
export async function transcriptProfile(engine: unknown, inputs: string[], settings: unknown, model: string) {
  const revisions = await Promise.all(inputs.map(async file => [file, await fileRevision(file)]))
  return createHash('sha256').update(JSON.stringify(['speech-v2', engine, revisions, settings, model])).digest('hex')
}

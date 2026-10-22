// Generated deliverables stay in their project; downloads save a copy wherever the user chooses.
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export async function artifactPath(dir: string, path: string): Promise<string> {
  const root = await realpath(dir)
  const file = await realpath(resolve(root, path))
  const rel = relative(root, file)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).some(p => p.startsWith('.'))) {
    throw new Error('Choose a file inside this project.')
  }
  if (!(await stat(file)).isFile()) throw new Error('This is not a file.')
  return file
}

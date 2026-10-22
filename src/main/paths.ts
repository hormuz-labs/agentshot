import path from 'node:path'

const pathsFor = (platform: string) => platform === 'win32' ? path.win32 : path.posix

/** Lexical boundary only: callers serving files must also authorize their realpaths against real roots. */
export function isWithinDir(root: string, file: string, platform = process.platform): boolean {
  const paths = pathsFor(platform)
  const rel = paths.relative(paths.resolve(root), paths.resolve(file))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel)
}

export const relativeProjectPath = (root: string, file: string, platform = process.platform) => {
  const paths = pathsFor(platform)
  return paths.relative(root, file).split(paths.sep).join('/')
}

export const executableName = (name: string, platform = process.platform) => platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name

/** Windows environment names are case-insensitive; never send both PATH and Path to a child. */
export function envPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const key = platform === 'win32' ? Object.keys(env).sort().find(k => k.toLowerCase() === 'path') : 'PATH'
  return (key && env[key]) || ''
}

export function withToolPath(dirs: string[], env: NodeJS.ProcessEnv = process.env, platform = process.platform): NodeJS.ProcessEnv {
  const out = { ...env }
  if (platform === 'win32') for (const key of Object.keys(out)) if (key.toLowerCase() === 'path') delete out[key]
  out.PATH = [...new Set(dirs), envPath(env, platform)].filter(Boolean).join(pathsFor(platform).delimiter)
  return out
}

/** Escape both FFmpeg option parsing and filtergraph parsing, not shell quoting (execFile passes argv directly). */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\':=\s]/g, '\\$&').replace(/[\\'\[\],;\s]/g, '\\$&')
}

export function escapeFilterPath(path: string): string {
  const portable = /^(?:[a-z]:[\\/]|\\\\)/i.test(path) ? path.replace(/\\/g, '/') : path
  return escapeFilterValue(portable)
}

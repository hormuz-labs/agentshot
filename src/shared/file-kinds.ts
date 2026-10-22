// What kind of file a name says it is (main uses it to describe added files, the renderer to pick icons and the video
// to start a project from).
import type { FileKind } from './types'

const EXT: Record<string, FileKind> = {}
for (const [kind, list] of Object.entries({
  video: 'mp4 mov m4v webm mkv avi mts m2ts mxf mpg mpeg wmv flv 3gp ogv dv',
  audio: 'mp3 wav m4a aac flac ogg oga opus aif aiff wma caf',
  image: 'png jpg jpeg webp gif bmp tif tiff heic heif avif svg',
  subtitles: 'srt vtt ass ssa sbv',
  text: 'txt md markdown json csv tsv xml yaml yml html htm edl fcpxml otio ttml dfxp',
  font: 'ttf otf ttc woff woff2',
  lut: 'cube 3dl',
})) for (const e of list.split(' ')) EXT[e] = kind as FileKind

export const extOf = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1].toLowerCase() ?? ''
/** The kind a file's name says; null when only ffprobe can tell (an unknown extension may still be media). */
export const kindByName = (name: string): FileKind | null => EXT[extOf(name)] ?? null

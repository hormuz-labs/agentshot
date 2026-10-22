import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeMediaPath, encodeMediaPath, filesystemSlug, pathBasename, toPortablePath } from '../src/shared/paths'
import { envPath, executableName, isWithinDir, relativeProjectPath, withToolPath } from '../src/main/paths'
import { mediaUrl } from '../src/renderer/src/lib/utils'

describe('media URL contract', () => {
  it.each([
    ['posix', '/home/me/My %23 clip #1?.mp4'],
    ['posix', '/tmp/back\\slash.mp4'],
    ['win32', String.raw`C:\Users\Me\My %23 clip #1?.mp4`],
    ['win32', String.raw`\\server\share\My %23 clip #1?.mp4`],
    ['win32', 'C:/Users/Me/My %23 clip #1?.mp4'],
    ['win32', '//server/share/My %23 clip #1?.mp4'],
    ['posix', '/'],
    ['win32', 'C:\\'],
  ] as const)('round trips %s path %s with a fixed authority', (platform, file) => {
    const encoded = encodeMediaPath(file, platform)
    const url = new URL(encoded)
    expect(url.host).toBe('media')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    expect(decodeMediaPath(url, platform)).toBe(platform === 'win32' ? file.replace(/\//g, '\\') : file)
    expect(decodeMediaPath(encoded, platform)).toBe(decodeMediaPath(url, platform))
  })

  it('uses exactly the same encoder in the renderer', () => {
    expect(mediaUrl).toBe(encodeMediaPath)
  })

  it.each([
    ['posix', '/home/me/My project/clips/title/clip.html'],
    ['win32', String.raw`D:\My project\clips\title\clip.html`],
    ['win32', String.raw`\\server\share\My project\clips\title\clip.html`],
  ] as const)('resolves relative clip assets on %s', (platform, clip) => {
    const paths = platform === 'win32' ? win32 : posix
    const asset = new URL('../images/My%20%2523%20%23%3F.png', encodeMediaPath(clip, platform))
    expect(asset.host).toBe('media')
    expect(decodeMediaPath(asset, platform)).toBe(paths.resolve(paths.dirname(clip), '../images/My %23 #?.png'))
    expect(decodeMediaPath(new URL('./style.css?cache=1#ignored', encodeMediaPath(clip, platform)), platform))
      .toBe(paths.join(paths.dirname(clip), 'style.css'))
  })

  it.each([
    'file:///tmp/a.mp4', 'manul://other/posix/tmp/a.mp4', 'manul://user@media/posix/tmp/a.mp4',
    'manul://media:90/posix/tmp/a.mp4', 'manul://media/posix/tmp/%',
    'manul://media/posix/tmp/a%2Fb.mp4', 'manul://media/posix/tmp/a%00b.mp4',
    'manul://media/relative/a.mp4',
  ])('rejects malformed or foreign URL %s', url => {
    expect(() => decodeMediaPath(url, 'posix')).toThrow()
  })

  it('does not turn foreign filesystem roots into host-relative paths', () => {
    expect(() => decodeMediaPath(encodeMediaPath('C:/video.mp4'), 'posix')).toThrow()
    expect(() => decodeMediaPath(encodeMediaPath('/tmp/video.mp4'), 'win32')).toThrow()
    expect(() => decodeMediaPath('manul://media/drive/C%3A/folder%5Cfile.mp4', 'win32')).toThrow()
    expect(() => encodeMediaPath('C:relative.mp4', 'win32')).toThrow()
    expect(() => encodeMediaPath('relative.mp4')).toThrow()
    expect(() => encodeMediaPath(String.raw`\\?\C:\video.mp4`, 'win32')).toThrow()
  })
})

describe('filesystem boundaries', () => {
  it.each([
    ['linux', '/projects/film', '/projects/film/media/a.mp4', true],
    ['linux', '/projects/film', '/projects/film/../outside.mp4', false],
    ['linux', '/projects/film', '/projects/film-old/a.mp4', false],
    ['linux', '/', '/projects/a.mp4', true],
    ['linux', '/projects/film', '/projects/film', false],
    ['win32', 'C:\\Projects\\Film', 'c:/projects/film/media/a.mp4', true],
    ['win32', 'C:\\Projects\\Film', 'C:\\Projects\\Film-old\\a.mp4', false],
    ['win32', 'C:\\Projects\\Film', 'C:\\Projects\\Film\\..\\outside.mp4', false],
    ['win32', 'C:\\Projects\\Film', 'D:\\Projects\\Film\\a.mp4', false],
    ['win32', 'C:\\', 'C:\\Projects\\a.mp4', true],
    ['win32', '\\\\Server\\Share\\Film', '\\\\server\\share\\film\\media\\a.mp4', true],
    ['win32', '\\\\Server\\Share\\Film', '\\\\server\\other\\film\\a.mp4', false],
  ] as const)('checks %s boundary %s / %s', (platform, root, file, expected) => {
    expect(isWithinDir(root, file, platform)).toBe(expected)
  })

  it('stores Windows drive and UNC relative paths with slashes', () => {
    expect(relativeProjectPath('C:\\Projects\\Film', 'C:\\Projects\\Film\\renders\\a.mp4', 'win32')).toBe('renders/a.mp4')
    expect(relativeProjectPath('\\\\Server\\Share\\Film', '\\\\Server\\Share\\Film\\notes\\a.jpg', 'win32')).toBe('notes/a.jpg')
    expect(toPortablePath('media\\My Clip.mp4')).toBe('media/My Clip.mp4')
    expect(pathBasename('media\\My Clip.mp4')).toBe('My Clip.mp4')
  })

  it.each(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'])('avoids Windows device folder %s', name => {
    expect(filesystemSlug(name)).toBe(`${name.toLowerCase()}-file`)
  })

  it('keeps ordinary slugs unchanged and trims after truncation', () => {
    expect(filesystemSlug('My Clip')).toBe('my-clip')
    expect(filesystemSlug('!!!')).toBe('project')
    expect(filesystemSlug('COM10')).toBe('com10')
    expect(filesystemSlug('a'.repeat(39) + ' b')).toBe('a'.repeat(39))
  })
})

describe('native tools environment', () => {
  it('adds .exe only on Windows', () => {
    expect(executableName('ffmpeg', 'win32')).toBe('ffmpeg.exe')
    expect(executableName('whisper-cli', 'win32')).toBe('whisper-cli.exe')
    expect(executableName('bsk.EXE', 'win32')).toBe('bsk.EXE')
    expect(executableName('ffmpeg', 'linux')).toBe('ffmpeg')
  })

  it('preserves a Windows Path value, uses semicolons, and leaves one canonical PATH key', () => {
    const env = { Path: 'C:\\Windows;C:\\User Tools', HOME: 'C:\\Users\\Me' }
    expect(envPath(env, 'win32')).toBe(env.Path)
    expect(withToolPath(['C:\\Manul\\bin', 'C:\\Manul\\bin'], env, 'win32')).toEqual({ HOME: env.HOME, PATH: 'C:\\Manul\\bin;C:\\Windows;C:\\User Tools' })
    expect(env.Path).toBe('C:\\Windows;C:\\User Tools')
    expect(envPath({ PATH: 'first', Path: 'second' }, 'win32')).toBe('first')
  })

  it('uses a POSIX delimiter and does not create empty PATH entries', () => {
    expect(withToolPath(['/app/bin'], { PATH: '/usr/bin', Path: 'not-PATH' }, 'linux')).toEqual({ PATH: '/app/bin:/usr/bin', Path: 'not-PATH' })
    expect(withToolPath(['/app/bin'], {}, 'linux').PATH).toBe('/app/bin')
  })
})

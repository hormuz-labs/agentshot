import { describe, expect, it } from 'vitest'
import { explain, forPhone } from '../src/main/explain'

const errno = (code: string, message: string) => Object.assign(new Error(message), { code })

describe('what went wrong, in words a person can act on', () => {
  it('names the cause of what the computer raised, never the raw error', () => {
    const cases: [unknown, RegExp][] = [
      [errno('ENOSPC', 'ENOSPC: no space left on device, write'), /disk is full/],
      [errno('ENOENT', "ENOENT: no such file or directory, open '/home/maya/clip.mov'"), /isn’t on the computer any more/],
      [errno('EACCES', "EACCES: permission denied, open '/Volumes/x'"), /isn’t allowed to open a file/],
      [new Error('ffprobe exited with code 1: moov atom not found'), /can’t be read/],
      [new Error('401 {"error":{"message":"Incorrect API key provided: sk-…"}}'), /turned down the key/],
      [new Error('429 Rate limit reached for gpt'), /busy right now/],
      [new Error('402 insufficient_quota'), /out of credit/],
      [new TypeError('fetch failed'), /couldn’t reach the service/],
      [errno('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443'), /couldn’t reach the service/],
      [new Error('Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.'), /store the key securely/],
      [new Error('Unsupported mobile method'), /don’t quite match/],
    ]
    for (const [error, words] of cases) {
      const said = explain(error)
      expect(said, String(error)).toMatch(words)
      expect(said).not.toMatch(/\/home|\/Volumes|ENO|EACCES|sk-|\{|Error:/)
    }
  })

  it('keeps AgentShot’s own messages, written for people', () => {
    expect(explain(new Error('Open a project first.'))).toBe('Open a project first.')
    expect(explain(new Error('No clip "intro".'))).toBe('No clip "intro".')
  })

  it('says something plain for anything else, without the machine in it', () => {
    for (const raw of [new TypeError("Cannot read properties of undefined (reading 'dir')"), new Error('at Object.<anonymous> (/app/out/main/index.js:12:3)'), 'x', undefined, {}]) {
      expect(explain(raw)).toMatch(/^Something went wrong on the computer\. Try again/)
    }
  })

  it('tells the phone what didn’t happen, and why', () => {
    expect(forPhone('agent:send', new Error('429 overloaded'))).toBe('Couldn’t send your note. The AI service is busy right now. Wait a minute, then try again.')
    expect(forPhone('upload', errno('ENOSPC', 'no space'))).toMatch(/^Couldn’t add the file\. The computer’s disk is full/)
    expect(forPhone('something:else', new Error('Open a project first.'))).toBe('Open a project first.')
    expect(forPhone(undefined, new TypeError('x is not a function'))).toMatch(/^Something went wrong/)
  })
})

describe('links', () => {
  it('leaves them out of AgentShot’s own messages, keeping the words', () => {
    expect(explain(new Error('Checksum mismatch for https://huggingface.co/x/ggml-large-v3.bin: the download was not what AgentShot expected, so it was discarded.')))
      .toBe('Checksum mismatch: the download was not what AgentShot expected, so it was discarded.')
  })
})

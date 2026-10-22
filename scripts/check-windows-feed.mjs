import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import yaml from 'js-yaml'

const dir = process.argv[2] || 'dist'
const feed = yaml.load(readFileSync(join(dir, 'latest.yml'), 'utf8'))
const expected = `Manul-${feed.version}-windows-x64-Setup.exe`
assert.equal(feed.path, expected)
assert.equal(basename(feed.path), feed.path)
assert.equal(feed.files.length, 1)
assert.equal(feed.files[0].url, expected)
const exe = readFileSync(join(dir, expected))
const hash = createHash('sha512').update(exe).digest('base64')
assert.equal(feed.sha512, hash)
assert.equal(feed.files[0].sha512, hash)
assert.equal(feed.files[0].size, exe.length)
if (process.env.WINDOWS_PUBLISHER_NAME) {
  const updater = yaml.load(readFileSync(join(dir, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8'))
  assert.deepEqual(updater.publisherName, [process.env.WINDOWS_PUBLISHER_NAME])
}
console.log(`Windows update feed: ${expected} ok`)

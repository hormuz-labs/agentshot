import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import AdmZip from 'adm-zip'
import yaml from 'js-yaml'
import { download, extractZip, sha256, zipFiles } from '../../scripts/archive.mjs'
import { BUILDS } from '../../scripts/fetch-ffmpeg.mjs'
import { CLI, EXTENSION } from '../../scripts/fetch-bsk.mjs'
import { WINDOWS_FLAGS, WINDOWS_IDENTITY } from '../../scripts/build-whisper.mjs'
import { assertUtf8Manifest, checkWhisperManifest } from '../../scripts/check-whisper-manifest.mjs'
import { MODEL, smokeWhisperPaths } from '../../scripts/smoke-whisper-paths.mjs'
import { checkPackaging } from '../../scripts/check-packaging.mjs'
import { windowsSigning } from '../../scripts/package.mjs'

const root = join(import.meta.dirname, '..', '..')
const require = createRequire(import.meta.url)
const config = yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
const temp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'manul packaging '))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('builder configuration is valid and explicitly offline one-click per-user Windows x64 NSIS', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js')
  await validateConfiguration(config)
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }])
  assert.equal(config.win.artifactName, 'Manul-${version}-windows-${arch}-Setup.exe')
  assert.equal(config.win.executableName, 'Manul')
  assert.equal(config.nsis.perMachine, false)
  assert.equal(config.nsis.allowElevation, false)
  assert.equal(config.nsis.oneClick, true)
  assert.equal(config.nsis.runAfterFinish, true)
  assert.equal(config.nsis.createDesktopShortcut, 'always')
  assert.equal(config.nsis.createStartMenuShortcut, true)
  assert.equal(config.nsis.shortcutName, 'Manul')
  assert.equal(config.nsis.allowToChangeInstallationDirectory, undefined)
  assert.equal(config.nsis.deleteAppDataOnUninstall, false)
  assert.equal(config.nsis.uninstallDisplayName, 'Manul')
  assert.equal(config.nsis.license, undefined, 'no licence acceptance page in the one-click install')
  assert.ok(config.extraResources.some(r => r.from === 'LICENSE' && r.to === 'LICENSE'))
  const filter = config.extraResources.find(r => r.to === 'bin').filter
  for (const pattern of ['*.exe', '*.dll', '*.DLL']) assert.ok(filter.includes(pattern))
  assert.equal(config.win.verifyUpdateCodeSignature, true)
})

test('one-click NSIS retains /D override and silent install does not auto-launch', async () => {
  // Check installed builder behavior, not an assumption based on assisted installer support.
  const templates = join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
  const oneClick = readFileSync(join(templates, 'oneClick.nsh'), 'utf8')
  const multiUser = readFileSync(join(templates, 'multiUser.nsh'), 'utf8')
  assert.match(oneClick, /!insertmacro setInstallModePerUser/)
  assert.match(multiUser, /!insertmacro GetDParameter \$R0\s+\$\{If\} \$R0 != ""\s+StrCpy \$INSTDIR \$R0/)
  const install = readFileSync(join(templates, 'installSection.nsh'), 'utf8')
  assert.match(install, /!ifdef RUN_AFTER_FINISH\s+\$\{ifNot\} \$\{Silent\}/)
  const smoke = readFileSync(join(root, 'scripts/smoke-windows-installer.ps1'), 'utf8')
  assert.match(smoke, /@\('\/S', '\/currentuser', "\/D=\$installDir"\)/)
  assert.match(smoke, /CreateShortcut\(\$link\)\.TargetPath/)
  const { computeLicensePage } = require('app-builder-lib/out/targets/nsis/nsisLicense.js')
  const buildFiles = await import('node:fs/promises').then(fs => fs.readdir(join(root, 'build')))
  const macros = []
  await computeLicensePage({ resourceList: Promise.resolve(buildFiles), getResource: async (_custom, ...names) => names.find(n => buildFiles.includes(n)) || null }, config.nsis, { macro: name => macros.push(name) }, ['en_US'])
  assert.deepEqual(macros, [], 'build resources must not auto-add a license wizard page')
})

test('Node minimum and directly declared ZIP dependency match the lockfile', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  assert.equal(pkg.engines.node, '>=22.19.0')
  assert.deepEqual(lock.packages[''].engines, pkg.engines)
  assert.equal(pkg.devDependencies['adm-zip'], '0.5.16')
  assert.equal(lock.packages[''].devDependencies['adm-zip'], '0.5.16')
  assert.equal(lock.packages['node_modules/adm-zip'].version, '0.5.16')
})

test('Windows download pins and exact archive layout match audited upstream releases', () => {
  assert.equal(BUILDS['win32-x64'].url, 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip')
  assert.equal(BUILDS['win32-x64'].sha256, '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba')
  assert.equal(BUILDS['win32-x64'].prefix, 'ffmpeg-9.0.2-essentials_build')
  assert.equal(CLI.builds['win32-x64'].url, 'https://github.com/Tencent/BrowserSkill/releases/download/cli-v0.3.2/bsk-v0.3.2-x86_64-pc-windows-msvc.zip')
  assert.equal(CLI.builds['win32-x64'].sha256, 'b773c443275b8581af29b314baa799e1ec599464379998edcf1dbc7eb07a7eab')
})

test('ZIP extraction handles nested files and spaces without an external executable', t => {
  const dir = temp(t)
  const zip = new AdmZip()
  zip.addFile('nested/manifest.json', Buffer.from('{}'))
  zip.addFile('bsk.exe', Buffer.from('MZ test'))
  const buf = zip.toBuffer()
  assert.equal(zipFiles(buf, ['bsk.exe'])[0].toString(), 'MZ test')
  assert.throws(() => zipFiles(buf, ['missing.exe']), /ZIP layout/)
  extractZip(buf, dir)
  assert.equal(readFileSync(join(dir, 'nested', 'manifest.json'), 'utf8'), '{}')
})

test('ZIP extraction refuses traversal and symlinks before writing files', t => {
  const dir = temp(t)
  for (const bad of ['../escape', '..\\escape', '/absolute', 'C:/escape', 'C:\\escape']) {
    const zip = new AdmZip()
    zip.addFile('safe', Buffer.from('safe'))
    zip.addFile('bad', Buffer.from('bad'))
    // Set the raw name after addFile, which itself sanitizes names.
    zip.getEntry('bad').entryName = bad
    assert.throws(() => extractZip(zip.toBuffer(), dir), /Unsafe ZIP/)
    assert.equal(existsSync(join(dir, 'safe')), false)
  }
  const zip = new AdmZip()
  zip.addFile('link', Buffer.from('../outside'))
  zip.getEntry('link').attr = (0xa1ff << 16) >>> 0
  assert.throws(() => extractZip(zip.toBuffer(), dir), /Unsafe ZIP/)
})

test('downloads fail closed on HTTP errors and checksum mismatches', async t => {
  const data = Buffer.from('archive')
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(data))
  assert.deepEqual(await download('https://example.test/file', sha256(data)), data)
  await assert.rejects(download('https://example.test/file', '0'.repeat(64)), /checksum mismatch/)
  fetchMock.mock.mockImplementation(async () => new Response('', { status: 404 }))
  await assert.rejects(download('https://example.test/file', sha256(data)), /HTTP 404/)
})

test('whisper MSVC build uses static CRT, no OpenMP and explicit SSE2 baseline', () => {
  for (const flag of ['-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded', '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_OPENMP=OFF', '-DGGML_NATIVE=OFF', '-DGGML_SSE42=OFF', '-DGGML_AVX=OFF', '-DGGML_AVX2=OFF',
    '-DGGML_BMI2=OFF', '-DGGML_FMA=OFF', '-DGGML_F16C=OFF', '-DGGML_BACKEND_DL=OFF']) assert.ok(WINDOWS_FLAGS.includes(flag), flag)
})

test('whisper UTF-8 manifest is supplied by a wrapper without patching pinned upstream sources', () => {
  const xml = readFileSync(join(root, 'scripts/windows-whisper/whisper-cli.manifest'), 'utf8')
  assertUtf8Manifest(xml)
  assert.throws(() => assertUtf8Manifest(xml.replace('>UTF-8<', '>Windows-1252<')), /UTF-8 activeCodePage/)
  assert.throws(() => assertUtf8Manifest(xml.replace('SMI/2019', 'SMI/2005')), /UTF-8 activeCodePage/)
  const cmake = readFileSync(join(root, 'scripts/windows-whisper/CMakeLists.txt'), 'utf8')
  assert.match(cmake, /add_subdirectory\("\$\{MANUL_WHISPER_SOURCE\}" upstream\)/)
  assert.match(cmake, /target_sources\(whisper-cli PRIVATE .*whisper-cli\.manifest"\)/)
  const build = readFileSync(join(root, 'scripts/build-whisper.mjs'), 'utf8')
  assert.match(build, /checkWhisperManifest\(exe\)/)
  assert.match(build, /'diff', '--exit-code'/)
  assert.equal(WINDOWS_IDENTITY, 'v1.9.4 windows-msvc-static-sse2-utf8-v2')
})

test('native Windows bundle has an embedded UTF-8 manifest', { skip: process.platform !== 'win32' }, () => {
  checkWhisperManifest(join(root, 'resources/bin/win32-x64/whisper-cli.exe'))
})

test('native Windows whisper transcribes with real model and Unicode/[] input/output paths', {
  skip: process.platform !== 'win32' || (!process.env.MANUL_TEST_WHISPER_MODEL && process.env.GITHUB_ACTIONS !== 'true'),
  timeout: 600000,
}, async () => {
  // Existing CI runs test:packaging after build:whisper. No workflow changes or runtime suite imports.
  await smokeWhisperPaths({ allowDownload: process.env.GITHUB_ACTIONS === 'true' })
})

test('native path acceptance requires an explicit model or download opt-in', async () => {
  assert.equal(MODEL.sha256, '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe')
  await assert.rejects(smokeWhisperPaths({ model: '', allowDownload: false }), /Set MANUL_TEST_WHISPER_MODEL/)
})

test('native path acceptance rejects an unpinned local model before running tools', async t => {
  const model = join(temp(t), 'wrong-model.bin')
  writeFileSync(model, 'not the pinned model')
  await assert.rejects(smokeWhisperPaths({ model }), /Use the pinned multilingual base model/)
})

test('unsigned local builds are permitted but always retain update signature verification', () => {
  const win = windowsSigning({})
  assert.equal(win.forceCodeSigning, false)
  assert.equal(win.verifyUpdateCodeSignature, true)
  assert.equal(win.signtoolOptions.publisherName, undefined)
})

test('public Windows release fails without complete credentials and exact publisher', () => {
  for (const env of [{ MANUL_PUBLIC_RELEASE: '1' }, { WIN_CSC_LINK: 'cert' }, { WINDOWS_PUBLISHER_NAME: 'Publisher' },
    { MANUL_PUBLIC_RELEASE: '1', WIN_CSC_LINK: 'cert', WIN_CSC_KEY_PASSWORD: 'password' }])
    assert.throws(() => windowsSigning(env), /Windows signing requires/)
  const win = windowsSigning({ MANUL_PUBLIC_RELEASE: '1', WIN_CSC_LINK: 'cert', WIN_CSC_KEY_PASSWORD: 'password', WINDOWS_PUBLISHER_NAME: 'Exact Certificate Publisher' })
  assert.equal(win.forceCodeSigning, true)
  assert.equal(win.signtoolOptions.publisherName, 'Exact Certificate Publisher')
})

test('portable release tag command fails before modifying metadata on invalid tags', () => {
  // release.yml exports TAG for the tag being built; the test drives the script through GITHUB_REF_NAME,
  // so an inherited TAG would make the invalid "main" look like a valid release tag.
  const env = { ...process.env, GITHUB_REF_NAME: 'main' }
  delete env.TAG
  const result = spawnSync(process.execPath, [join(root, 'scripts/version-from-tag.mjs')], { encoding: 'utf8', env })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Invalid release tag/)
})

function packagingFixture(t) {
  const dir = temp(t)
  const put = (name, value = 'resource') => { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), value) }
  const bin = 'resources/bin/win32-x64'
  for (const tool of ['ffmpeg', 'ffprobe', 'whisper-cli', 'bsk']) put(`${bin}/${tool}.exe`, 'MZ test')
  for (const tool of ['ffmpeg', 'ffprobe']) put(`${bin}/.${tool}.sha256`, BUILDS['win32-x64'].sha256)
  put(`${bin}/.bsk.sha256`, CLI.builds['win32-x64'].sha256)
  put(`${bin}/.whisper-cli.version`, `${WINDOWS_IDENTITY}\n`)
  for (const name of ['ffmpeg-LICENSE.txt', 'ffmpeg-README.txt', 'whisper-LICENSE.txt']) put(`${bin}/${name}`)
  put(`${bin}/vcruntime140.dll`, 'MZ test DLL')
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'resources/bsk-ext/manifest.json',
    'resources/lib/gsap.min.js', 'resources/lib/fonts/Inter.woff2', 'resources/lib/fonts/Inter-Regular.ttf', 'resources/lib/fonts/Inter-Bold.ttf', 'resources/lib/fonts/Inter-LICENSE.txt']) put(name)
  put('resources/bsk-ext/.sha256', EXTENSION.sha256)
  for (const name of ['resources/skills', 'resources/py']) mkdirSync(join(dir, name), { recursive: true })
  const calls = []
  const run = (exe, args) => {
    calls.push({ exe, args })
    if (exe.endsWith('ffmpeg.exe')) return 'ffmpeg version 9.0.2 --enable-gpl --enable-libx264 --enable-libass'
    if (exe.endsWith('ffprobe.exe')) return 'ffprobe version 9.0.2 --enable-gpl --enable-libx264 --enable-libass'
    return exe.endsWith('bsk.exe') ? 'bsk 0.3.2' : 'whisper.cpp 1.9.4'
  }
  return { dir, put, calls, options: { root: dir, platform: 'win32', arch: 'x64', run } }
}

test('packaging preflight executes all four bundled Windows tools with .exe paths', t => {
  const f = packagingFixture(t)
  checkPackaging(f.options)
  assert.equal(f.calls.length, 4)
  assert.ok(f.calls.every(c => c.exe.endsWith('.exe')))
})

test('packaging preflight fails on missing binaries, stale pins, wrong versions and absent fonts', t => {
  const f = packagingFixture(t)
  const exe = 'resources/bin/win32-x64/ffmpeg.exe'
  rmSync(join(f.dir, exe))
  assert.throws(() => checkPackaging(f.options), /Packaging resource missing/)
  f.put(exe, 'not PE')
  assert.throws(() => checkPackaging(f.options), /Not a Windows executable/)
  f.put(exe, 'MZ test')
  assert.throws(() => checkPackaging({ ...f.options, run: () => 'ffmpeg version 8.0' }), /Unexpected ffmpeg version/)
  assert.throws(() => checkPackaging({ ...f.options, run: () => 'ffmpeg version 9.0.2' }), /lacks required/)
  f.put('resources/bin/win32-x64/.ffmpeg.sha256', 'old')
  assert.throws(() => checkPackaging(f.options), /Stale packaging resource/)
  f.put('resources/bin/win32-x64/.ffmpeg.sha256', BUILDS['win32-x64'].sha256)
  rmSync(join(f.dir, 'resources/bin/win32-x64/vcruntime140.dll'))
  assert.throws(() => checkPackaging(f.options), /Packaging resource missing/)
  f.put('resources/bin/win32-x64/vcruntime140.dll', 'MZ test DLL')
  rmSync(join(f.dir, 'resources/lib/fonts/Inter-Regular.ttf'))
  assert.throws(() => checkPackaging(f.options), /Packaging resource missing/)
  assert.throws(() => checkPackaging({ ...f.options, arch: 'arm64' }), /Unsupported packaging target/)
})

test('beforePack rejects cross-host/architecture packaging before resource checks', async () => {
  const { default: hook } = require('../../scripts/before-pack.cjs')
  const { Arch } = require('builder-util')
  await assert.rejects(hook({ electronPlatformName: process.platform === 'win32' ? 'linux' : 'win32', arch: Arch.x64 }), /native runner/)
  await assert.rejects(hook({ electronPlatformName: process.platform, arch: Arch[process.arch === 'x64' ? 'arm64' : 'x64'] }), /native runner/)
})

test('packaged E2E fails rather than skipping when package is missing', t => {
  const result = spawnSync(process.execPath, [join(root, 'test/e2e/packaged.e2e.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, MANUL_PACKAGED_EXE: join(temp(t), 'missing.exe') },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Packaged executable missing/)
})

test('Windows latest.yml must reference the actual installer bytes, name and size', t => {
  const dir = temp(t)
  const exe = Buffer.from('MZ test installer')
  const name = 'Manul-0.0.1-windows-x64-Setup.exe'
  const hash = createHash('sha512').update(exe).digest('base64')
  writeFileSync(join(dir, name), exe)
  const feed = { version: '0.0.1', path: name, sha512: hash, files: [{ url: name, sha512: hash, size: exe.length }] }
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-windows-feed.mjs'), dir], { encoding: 'utf8', env: { ...process.env, WINDOWS_PUBLISHER_NAME: '' } })
  writeFileSync(join(dir, 'latest.yml'), yaml.dump(feed))
  assert.equal(run().status, 0)
  feed.files[0].sha512 = 'wrong'
  writeFileSync(join(dir, 'latest.yml'), yaml.dump(feed))
  assert.notEqual(run().status, 0)
})

test('CI builds Windows natively; public uploads include installer, blockmap and latest.yml', () => {
  const ci = yaml.load(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'))
  const release = yaml.load(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'))
  assert.equal(ci.jobs['windows-package']['runs-on'], 'windows-2022')
  assert.equal(ci.jobs['windows-package'].defaults.run.shell, 'pwsh')
  assert.ok(release.jobs.build.strategy.matrix.include.some(m => m.os === 'windows-2022' && m.arch === 'x64'))
  const steps = release.jobs.build.steps
  assert.ok(steps.some(s => s.env?.MANUL_PUBLIC_RELEASE === '1' && s.name.includes('Require public Windows')))
  assert.ok(steps.some(s => s.run?.includes('check-windows-signatures.ps1')))
  assert.ok(steps.some(s => s.run?.includes('smoke-windows-installer.ps1')))
  const upload = steps.find(s => s.uses?.startsWith('actions/upload-artifact'))
  for (const glob of ['dist/*.exe', 'dist/*.blockmap', 'dist/latest*.yml']) assert.ok(upload.with.path.includes(glob))
  const smoke = readFileSync(join(root, 'scripts/smoke-windows-installer.ps1'), 'utf8')
  assert.match(smoke, /RUNNER_ENVIRONMENT -ne 'github-hosted'/)
  assert.match(smoke, /Refusing to touch an existing Manul installation/)
  const dependencies = readFileSync(join(root, 'scripts/check-windows-dependencies.ps1'), 'utf8')
  assert.match(dependencies, /Get-AuthenticodeSignature/)
  assert.match(dependencies, /Microsoft Corporation/)
  assert.match(dependencies, /\$name -eq 'bsk.exe' -and \$dll -ieq 'VCRUNTIME140.dll'/)
  assert.match(dependencies, /dumpbin \/DEPENDENTS/)
})

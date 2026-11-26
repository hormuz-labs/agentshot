#!/usr/bin/env node
// Build agentshot-mcp (scripts/launcher, Rust): the small program the Claude app and Codex start to reach AgentShot.
// For this machine, into resources/bin/<platform>-<arch>/. Needs cargo (https://rustup.rs).
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const exe = process.platform === 'win32' ? 'agentshot-mcp.exe' : 'agentshot-mcp'
const out = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', join(root, 'scripts', 'launcher', 'Cargo.toml')], { stdio: 'inherit' })
mkdirSync(out, { recursive: true })
copyFileSync(join(root, 'scripts', 'launcher', 'target', 'release', exe), join(out, exe))
if (process.platform !== 'win32') chmodSync(join(out, exe), 0o755)
console.log(`built ${join('resources', 'bin', `${process.platform}-${process.arch}`, exe)}`)

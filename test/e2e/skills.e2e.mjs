// Settings → Skills: a person writes a skill of their own, switches it off and on, changes it and deletes it. Their
// skills are plain files in their own folder, and are still there after the app restarts.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'agentshot-skills-e2e-'))
const userData = mkdtempSync(join(tmpdir(), 'agentshot-ud-'))
const file = id => join(userData, 'my-skills', id, 'SKILL.md')
const check = (ok, what) => { if (!ok) throw new Error(what) }

async function open(first) {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  if (first) await dismissOnboarding(win)
  await win.click('[aria-label="Settings"]')
  if (first) await dismissSettingsOnboarding(win)
  await win.click('nav >> text=Skills')
  await win.waitForSelector('text=Built in')
  return { app, win }
}
const state = win => win.evaluate(() => window.agentshot.skills.state())

let { app, win } = await open(true)
try {
  // nothing of their own yet: an invitation, above the built-in skills
  await win.waitForSelector('[data-own-empty]')
  const builtIn = await win.locator('[data-skill]:not([data-own])').count()
  check(builtIn >= 9, `expected the built-in skills, saw ${builtIn}`)
  check(await win.locator('[data-skill][data-own]').count() === 0, 'a fresh install has a skill of its own')
  await win.screenshot({ path: join(out, '1-empty.png') })

  // writing one: it says what is missing, in order, and saves nothing until it is whole
  await win.click('text=Write your first skill')
  const editor = win.locator('[data-skill-editor]')
  await editor.waitFor()
  await editor.locator('button[type=submit]').click()
  await editor.locator('[role=alert]', { hasText: 'Give the skill a name.' }).waitFor()
  await editor.locator('[name=name]').fill('My podcast style')
  await editor.locator('button[type=submit]').click()
  await editor.locator('[role=alert]', { hasText: 'Say when to use it' }).waitFor()
  await editor.locator('[name=description]').fill('Editing episodes of my podcast: “make it tight”')
  await editor.locator('button[type=submit]').click()
  await editor.locator('[role=alert]', { hasText: 'Say what to do.' }).waitFor()
  check(!existsSync(join(userData, 'my-skills', 'my-podcast-style')), 'a skill was written before it was whole')
  await editor.locator('[name=body]').fill('- Open on the strongest line, never on the intro.\n- Cut every “um”.\n- Keep the laughs.')
  check(await editor.locator('[role=alert]').count() === 0, 'the complaint stays after the field is filled in')
  await win.screenshot({ path: join(out, '2-writing.png') })
  await editor.locator('button[type=submit]').click()

  // it is listed under Yours, above the built-in ones, switched on, and is a plain file
  const row = win.locator('[data-skill="my-podcast-style"][data-own]')
  await row.waitFor()
  check(/My podcast style/.test(await row.innerText()) && /Editing episodes of my podcast/.test(await row.innerText()), `row wrong: ${await row.innerText()}`)
  check(await editor.count() === 0 && await win.locator('[data-own-empty]').count() === 0, 'the editor or the invitation is still showing')
  const order = await win.locator('[data-skill]').evaluateAll(rows => rows.map(r => r.getAttribute('data-skill')))
  check(order[0] === 'my-podcast-style', `theirs is not listed first: ${order}`)
  check(await row.locator('[role=switch]').getAttribute('aria-checked') === 'true', 'a new skill is not on')
  check((await state(win)).enabled.includes('my-podcast-style'), 'the app does not count it as on')
  const written = readFileSync(file('my-podcast-style'), 'utf8')
  check(written.startsWith('---\nname: my-podcast-style\ntitle: >-\n  My podcast style\n') && written.includes('- Cut every “um”.'), `file wrong:\n${written}`)
  await win.screenshot({ path: join(out, '3-listed.png') })

  // off and on, like any skill
  await row.locator('[role=switch]').click()
  await row.locator('[role=switch][aria-checked=false]').waitFor()
  check(!(await state(win)).enabled.includes('my-podcast-style'), 'the switch shows off but the app still counts the skill as on')
  await row.locator('[role=switch]').click()
  await row.locator('[role=switch][aria-checked=true]').waitFor()
  check((await state(win)).enabled.includes('my-podcast-style'), 'the switch shows on but the app counts the skill as off')

  // changing it: what was written comes back, and a new name keeps the same skill
  await row.locator('button', { hasText: 'Edit' }).click()
  await editor.waitFor()
  check(await editor.locator('[name=name]').inputValue() === 'My podcast style', 'the name did not come back')
  check(await editor.locator('[name=description]').inputValue() === 'Editing episodes of my podcast: “make it tight”', 'when to use it did not come back')
  check((await editor.locator('[name=body]').inputValue()).endsWith('- Keep the laughs.'), 'what to do did not come back')
  await editor.locator('[name=name]').fill('Podcast, v2')
  await editor.locator('[name=body]').fill('- Open cold.\n- Keep the laughs.')
  await editor.locator('button[type=submit]').click()
  await win.locator('[data-skill="my-podcast-style"]', { hasText: 'Podcast, v2' }).waitFor()
  check(await win.locator('[data-skill][data-own]').count() === 1, 'changing a skill made another')
  check(readFileSync(file('my-podcast-style'), 'utf8').endsWith('---\n\n- Open cold.\n- Keep the laughs.\n'), 'the file was not rewritten')

  // a second one, and backing out of a third leaves nothing behind
  await win.click('button:has-text("New skill")')
  await editor.locator('[name=name]').fill('Reels')
  await editor.locator('[name=description]').fill('Vertical clips for Instagram')
  await editor.locator('[name=body]').fill('Fast. Captions on.')
  await editor.locator('button[type=submit]').click()
  await win.locator('[data-skill="reels"][data-own]').waitFor()
  await win.click('button:has-text("New skill")')
  await editor.locator('[name=name]').fill('Never mind')
  await editor.locator('button', { hasText: 'Cancel' }).click()
  check(await win.locator('[data-skill][data-own]').count() === 2 && !existsSync(join(userData, 'my-skills', 'never-mind')), 'cancelling wrote something')

  await app.close()
  // still there after a restart
  ;({ app, win } = await open(false))
  await win.locator('[data-skill="my-podcast-style"]', { hasText: 'Podcast, v2' }).waitFor()
  await win.locator('[data-skill="reels"][data-own]').waitFor()

  // deleting asks first, and keeps the skill if the answer is no
  await win.locator('[data-skill="reels"] button', { hasText: 'Edit' }).click()
  const again = win.locator('[data-skill-editor]')
  await again.locator('button', { hasText: 'Delete' }).click()
  await again.locator('text=Delete this skill for good?').waitFor()
  await win.screenshot({ path: join(out, '4-deleting.png') })
  await again.locator('button', { hasText: 'Keep it' }).click()
  check(await again.locator('text=Delete this skill for good?').count() === 0 && existsSync(file('reels')), 'saying no still deleted, or the question stayed')
  await again.locator('button', { hasText: 'Delete' }).click()
  await again.locator('button', { hasText: /^Delete$/ }).last().click()
  await win.locator('[data-skill="reels"]').waitFor({ state: 'detached' })
  check(!existsSync(join(userData, 'my-skills', 'reels')), 'the deleted skill is still on disk')
  check(existsSync(file('my-podcast-style')), 'deleting one skill removed another')
  check(await win.locator('[data-skill]:not([data-own])').count() === builtIn, 'the built-in skills changed')
  // none of the built-in skills can be edited
  check(await win.locator('[data-skill]:not([data-own]) button:has-text("Edit")').count() === 0, 'a built-in skill offers Edit')
  console.log('skills e2e ok:', out)
} finally { await app.close() }

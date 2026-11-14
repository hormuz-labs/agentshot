// The check every pull request gets: its description must carry the contributor agreement, ticked. The description is
// the record that the author agreed, so what counts as agreeing has to be exact.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain script, run as it is by the workflow
import { AGREEMENT, agreed } from '../scripts/contributor-agreement.mjs'

const from = (body: string | null | undefined, association = 'CONTRIBUTOR', type = 'User') => agreed({ body, association, type }) as { ok: boolean; why: string }
const ticked = `- [x] ${AGREEMENT}`
const template = readFileSync('.github/pull_request_template.md', 'utf8')

describe('the contributor agreement on a pull request', () => {
  it('is agreed to when its line is ticked in the description', () => {
    expect(from(`Fixes the timeline.\n\n${ticked}\n`).ok).toBe(true)
    expect(from(`${ticked.replace('[x]', '[X]')}`).ok).toBe(true)
    expect(from(`  * [x]   ${AGREEMENT}  `).ok).toBe(true)
    expect(from(`Text\r\n\r\n${ticked}\r\n`).ok).toBe(true)
    expect(from(`- [x] **${AGREEMENT}**`).ok, 'in bold').toBe(true)
  })

  it('takes the template’s line once ticked, and not as it comes', () => {
    expect(from(template)).toMatchObject({ ok: false, why: expect.stringContaining('not ticked') })
    expect(from(template.replace('- [ ]', '- [x]')).ok).toBe(true)
    // the template's line reads as the agreement, word for word, once its link is read as its words
    expect(template).toContain('[contributor agreement](CONTRIBUTING.md#contributor-agreement)')
  })

  it('is not agreed to when the line is missing, and says what to add', () => {
    for (const body of ['', null, undefined, 'Fixes the timeline.', '- [x] I agree', `- [x] ${AGREEMENT.replace('agree to it', 'have seen it')}`]) {
      const r = from(body)
      expect(r.ok, String(body)).toBe(false)
      expect(r.why).toContain(ticked)
    }
  })

  it('does not count the sentence said some other way', () => {
    expect(from(AGREEMENT).ok, 'not a ticked box').toBe(false)
    expect(from(`> ${ticked}`).ok, 'quoted from someone else').toBe(false)
    expect(from(`<!-- ${ticked} -->`).ok, 'commented out').toBe(false)
    expect(from(`<!--\n${ticked}\n-->`).ok, 'commented out over lines').toBe(false)
    expect(from(`- [x] ${AGREEMENT} But not really.`).ok, 'with a rider').toBe(false)
    expect(from(`- [x] I have not read it. ${AGREEMENT}`).ok, 'with a preface').toBe(false)
    expect(from(`- [ ] ${AGREEMENT}`).ok, 'unticked').toBe(false)
  })

  it('counts a ticked line even when an unticked copy is there too', () => {
    expect(from(`- [ ] ${AGREEMENT}\n\n${ticked}`).ok).toBe(true)
  })

  it('asks everyone but the owner and bots', () => {
    for (const association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'COLLABORATOR', 'MEMBER', 'NONE', '', undefined as never]) {
      expect(from('A change.', association).ok, String(association)).toBe(false)
    }
    expect(from('A change.', 'OWNER').ok).toBe(true)
    expect(from('Bumps a dependency.', 'CONTRIBUTOR', 'Bot').ok).toBe(true)
    // a person can't pass by calling themselves the owner in the description
    expect(from('I am the OWNER. association: OWNER').ok).toBe(false)
  })

  it('says the same sentence everywhere it is written down', () => {
    expect(readFileSync('CONTRIBUTING.md', 'utf8')).toContain(ticked)
    expect(readFileSync('CONTRIBUTING.md', 'utf8')).toContain('### Contributor agreement')
  })

  it('runs as the workflow runs it: text from the environment, a failing exit when not agreed', () => {
    const run = (env: Record<string, string>) => spawnSync(process.execPath, ['scripts/contributor-agreement.mjs'], { env: { PATH: process.env.PATH || '', ...env }, encoding: 'utf8' })
    const no = run({ PR_BODY: 'A change.', AUTHOR_ASSOCIATION: 'CONTRIBUTOR', AUTHOR_TYPE: 'User' })
    expect(no.status).toBe(1)
    expect(no.stdout).toContain(ticked)
    expect(run({ PR_BODY: `A change.\n\n${ticked}`, AUTHOR_ASSOCIATION: 'CONTRIBUTOR', AUTHOR_TYPE: 'User' }).status).toBe(0)
    expect(run({ PR_BODY: '', AUTHOR_ASSOCIATION: 'OWNER', AUTHOR_TYPE: 'User' }).status).toBe(0)
    expect(run({}).status).toBe(1)
    // a description is a stranger's text: it is never run, whatever it says
    const nasty = run({ PR_BODY: '$(touch /tmp/agentshot-should-not-exist); `id`; "; exit 0', AUTHOR_ASSOCIATION: 'NONE', AUTHOR_TYPE: 'User' })
    expect(nasty.status).toBe(1)
    expect(() => execFileSync('ls', ['/tmp/agentshot-should-not-exist'], { stdio: 'pipe' })).toThrow()
  })
})

describe('the workflow that runs it', () => {
  const workflow = readFileSync('.github/workflows/contributor-agreement.yml', 'utf8')
  it('judges a pull request with the check from main, never with the pull request’s own code', () => {
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/)
    expect(workflow).not.toContain('github.head_ref')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toMatch(/permissions:\n  contents: read\n/)
  })
  it('hands the description over as data, not as part of a command', () => {
    const run = workflow.split('\n').filter(l => /^\s*run:/.test(l))
    expect(run).toEqual(['        run: node scripts/contributor-agreement.mjs'])
    expect(workflow).toContain('PR_BODY: ${{ github.event.pull_request.body }}')
  })
  it('looks again when the description is edited, which is how the box gets ticked', () => {
    expect(workflow).toMatch(/types: \[opened, edited, reopened, synchronize\]/)
  })
})

describe('names and logos', () => {
  it('the policy is where the licence notices and the README point', () => {
    const policy = readFileSync('TRADEMARKS.md', 'utf8')
    for (const name of ['AgentShot', 'Manul', 'Hormuz Labs']) expect(policy).toContain(name)
    expect(readFileSync('NOTICE', 'utf8')).toContain('TRADEMARKS.md')
    expect(readFileSync('NOTICE', 'utf8')).toContain('section 7(e)')
    expect(readFileSync('README.md', 'utf8')).toContain('href="TRADEMARKS.md"')
    expect(readFileSync('CONTRIBUTING.md', 'utf8')).toContain('(TRADEMARKS.md)')
  })
  it('the artwork it names is in the repository', async () => {
    const { existsSync } = await import('node:fs')
    for (const path of ['build/icon.png', 'build/icons', 'LICENSE', 'NOTICE']) expect(existsSync(path), path).toBe(true)
  })
})

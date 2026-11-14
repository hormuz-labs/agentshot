// Says whether a pull request carries its author's agreement to the contributor agreement (CONTRIBUTING.md): the
// sentence below, ticked, in the pull request's description. The description and its history stay on GitHub, which is
// the record that they agreed. Run by .github/workflows/contributor-agreement.yml on every pull request.

/** What a contributor ticks. The pull request template carries it, with "contributor agreement" as a link. */
export const AGREEMENT = 'I have read the contributor agreement in CONTRIBUTING.md and agree to it for this contribution.'

const plain = text => text
  .replace(/<!--[\s\S]*?-->/g, '')                 // a commented-out line was not said
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // a link reads as its words
  .replace(/`|\*\*|__/g, '')                        // bold or code around the words changes nothing; a lone * is a bullet

/**
 * @param {{ body?: string | null, association?: string, type?: string }} pr the description, how the author stands to
 *   the repository (GitHub's author_association) and what kind of account they are
 * @returns {{ ok: boolean, why: string }}
 */
export function agreed({ body, association, type }) {
  // the copyright holder's own account has nobody to make the agreement with
  if (association === 'OWNER') return { ok: true, why: 'The repository’s owner needs no agreement with themselves.' }
  // a bot can't agree to anything; what it sends is a version number changed by a rule
  if (type === 'Bot') return { ok: true, why: 'Opened by a bot.' }
  const want = AGREEMENT.toLowerCase()
  let unticked = false
  for (const line of plain(body || '').split(/\r?\n/)) {
    const box = /^\s*[-*+]\s*\[([ xX])\]\s*(.*)$/.exec(line)
    if (!box || box[2].replace(/\s+/g, ' ').trim().toLowerCase() !== want) continue
    if (box[1] !== ' ') return { ok: true, why: 'The contributor agreement is ticked.' }
    unticked = true
  }
  return {
    ok: false,
    why: unticked
      ? 'The contributor agreement is in the description but not ticked. Read it in CONTRIBUTING.md, then tick the box: change "- [ ]" to "- [x]".'
      : `This pull request doesn't say its author agrees to the contributor agreement. Read it in CONTRIBUTING.md, then add this line to the description:\n\n- [x] ${AGREEMENT}`,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = agreed({ body: process.env.PR_BODY, association: process.env.AUTHOR_ASSOCIATION, type: process.env.AUTHOR_TYPE })
  console.log(r.why)
  process.exit(r.ok ? 0 : 1)
}

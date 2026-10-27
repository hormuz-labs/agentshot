// What went wrong, in words a person can act on: a failed import, render or note shows this instead of the raw error
// (an errno, a stack, a path on the computer, an HTTP status from a model's API). Messages AgentShot wrote for people
// pass as they are; anything else is matched to its cause, or said plainly with what to try.

/** A message written for people: a sentence, short, with nothing of the machine in it (paths, codes, stacks). */
function readable(message: string) {
  return message.length > 0 && message.length <= 240 &&
    /^[A-Z“"']/.test(message) &&
    !/(^|\s)(\/[\w.-]+){2,}|[A-Za-z]:\\|\bat \S+:\d+|\bE[A-Z]{3,}\b|\b(TypeError|ReferenceError|SyntaxError|undefined|null|NaN)\b|\[object /.test(message)
}

/** Links out of a message (where a download came from, an API's address): the words stay. */
const unlinked = (message: string) => message.replace(/\s+(for|from|at|to)\s+https?:\/\/\S+?(?=[:,;]?\s|[:,;]?$)/g, '').replace(/https?:\/\/\S+/g, 'a link')

const causes: [RegExp, string][] = [
  [/ENOSPC|no space left/i, 'The computer’s disk is full. Free up some space, then try again.'],
  [/EACCES|EPERM|permission denied|operation not permitted/i, 'AgentShot isn’t allowed to open a file it needs on the computer. Check the project folder’s permissions.'],
  [/ENOENT|no such file/i, 'A file this needs isn’t on the computer any more: it may have been moved or deleted.'],
  [/safeStorage|encryption is not available/i, 'The computer couldn’t store the key securely. Unlock its keychain (or sign in to it again), then try again.'],
  [/invalid data found|moov atom|could not find codec|unknown format|invalid argument|ffprobe|demux|corrupt/i, 'This file can’t be read: it may be damaged, still downloading, or in a format AgentShot can’t open. Try exporting it again as MP4.'],
  [/incorrect api key|invalid[_ -]?api[_ -]?key|invalid x-api-key|\b401\b|unauthori[sz]ed|authentication/i, 'The AI service turned down the key on the computer. Check it in Settings → AI models.'],
  [/insufficient[_ ]?(quota|credit|balance)|billing|payment required|\b402\b|out of credits/i, 'The AI account is out of credit. Top up, or use another key in Settings → AI models.'],
  [/rate[_ ]?limit|too many requests|\b429\b|overloaded|\b529\b/i, 'The AI service is busy right now. Wait a minute, then try again.'],
  [/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENETUNREACH|fetch failed|network|socket hang up|timed? ?out/i, 'The computer couldn’t reach the service it needed. Check its internet connection, then try again.'],
  [/context length|too long|maximum context|token limit/i, 'That’s more than the model can take in at once. Start a new conversation, or ask about a shorter part.'],
  [/\b5\d\d\b|internal server error|bad gateway|service unavailable/i, 'The AI service had a problem on its side. Try again in a moment.'],
  [/ZodError|Unsupported mobile method|invalid_type|Expected .* received/i, 'This version of the app and AgentShot on the computer don’t quite match. Update both, then try again.'],
]

/** Why it failed, for a person: AgentShot's own words when it wrote them, else the cause in plain words. */
export function explain(error: unknown): string {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim()
  const code = (error as { code?: unknown } | undefined)?.code
  const text = `${typeof code === 'string' ? code + ' ' : ''}${message}`
  for (const [pattern, words] of causes) if (pattern.test(text)) return words
  const plain = unlinked(message)
  if (readable(plain)) return plain
  return 'Something went wrong on the computer. Try again; if it keeps happening, restart AgentShot there.'
}

/** What the phone was asking for, said as what didn't happen ("Couldn’t send your note"). */
export const doing: Record<string, string> = {
  'agent:send': 'Couldn’t send your note',
  'project:create': 'Couldn’t start the project',
  'project:createMotion': 'Couldn’t start the project',
  'project:open': 'Couldn’t open the project',
  'project:decide': 'Couldn’t save your choice',
  'mobile:export': 'Couldn’t export the film',
  'export:run': 'Couldn’t export the film',
  'timeline:edit': 'Couldn’t change the timeline',
  'clip:render': 'Couldn’t render the clip',
  'account:adopt': 'Couldn’t switch to your AgentShot credits',
  'keys:set': 'Couldn’t save the key',
  upload: 'Couldn’t add the file',
  voice: 'Couldn’t hear your voice note',
}

/** The phone's line for a request that failed: what didn't happen, and why. */
export function forPhone(what: string | undefined, error: unknown) {
  const why = explain(error)
  const failed = what ? doing[what] : undefined
  return failed ? `${failed}. ${why}` : why
}

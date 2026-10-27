/** What a failed step means, in words anyone can follow; the raw error stays under the step's details. */
export function toolErrorHint(tool: string, result: string) {
  if (/Accept or reject the proposed version first/i.test(result)) return 'A new cut is waiting for you. Keep it or send it back, then the agent can carry on.'
  if (tool === 'bash' && /Operation not permitted/.test(result)) return 'That was outside the project’s folder, so it was blocked.'
  if (/was aborted|aborterror|stopped/i.test(result)) return 'This was stopped before it finished.'
  if (/Unrecognized option|Option not found/.test(result)) return 'The tool didn’t understand how it was asked; the agent can try another way.'
  if (/invalid data found|moov atom not found|could not find codec/i.test(result)) return 'That video file looks damaged or unfinished.'
  if (/ENOENT|no such file|not found|does not exist/i.test(result)) return 'That file isn’t in the project.'
  if (/EACCES|permission denied/i.test(result)) return 'The computer didn’t allow access to that file.'
  if (/ENOSPC|no space left/i.test(result)) return 'The computer ran out of disk space.'
  if (/timed? ?out|ETIMEDOUT/i.test(result)) return 'This took too long and was stopped.'
  if (/ECONNREFUSED|ENOTFOUND|network|fetch failed/i.test(result)) return 'The computer couldn’t reach the internet for this.'
  return 'This step didn’t work; the agent carries on without it.'
}

/** Explain real failures without implying that every error is a broken shell. Preserve raw diagnostics on expansion. */
export function toolErrorHint(tool: string, result: string) {
  if (/Accept or reject the proposed version first/i.test(result)) return 'A preview is awaiting a decision. Accept it to continue editing that result, or reject it to keep the current version.'
  if (tool === 'bash' && /Operation not permitted/.test(result)) return 'This command reached outside the project’s allowed folders. Bash is working; the sandbox blocked that path.'
  if (/was aborted|aborterror|stopped/i.test(result)) return 'This operation was stopped before it finished.'
  if (/Unrecognized option|Option not found/.test(result)) return 'The command used an option this tool version does not support.'
  if (/ENOENT/.test(result)) return 'A requested file or program could not be found.'
  return 'This step failed. Expand it to see the details.'
}

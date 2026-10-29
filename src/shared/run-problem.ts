/** AgentShot's problem with the AI service, as a turn ended on it: what it means and what to do, in words (its own message stays under
 *  details). The phone says it the same way (mobile/lib/ui/steps.dart). */
export function runProblem(message: string) {
  const m = message.toLowerCase()
  if (/rate.?limit|429|too many requests/.test(m)) return 'The AI service is getting too many requests right now. Wait a minute, then ask AgentShot again.'
  if (/overloaded|529|503|unavailable|capacity/.test(m)) return 'The AI service is overloaded right now. Ask AgentShot again in a moment.'
  if (/\b50[024]\b|bad gateway|internal server error|gateway time-?out/.test(m)) return 'The AI service had a problem on its side. Ask AgentShot again in a moment.'
  if (/credit|balance|402|quota|billing|insufficient/.test(m)) return 'There aren’t enough AI credits for AgentShot to carry on. Add credits, then ask again.'
  if (/network|econn|fetch failed|timed? ?out|socket|enotfound/.test(m)) return 'This computer couldn’t reach the AI service. Check the internet connection, then ask AgentShot again.'
  if (/api.?key|401|403|unauthori[sz]ed|forbidden/.test(m)) return 'The AI service didn’t accept this computer’s key. Check it in Settings.'
  return 'AgentShot stopped before it finished. What it did so far is kept; ask again to carry on.'
}

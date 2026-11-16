// Problems as the person should read them: what happened and what to do, never a raw error or log line.

/// AgentShot's problem with the AI service, as the turn ended on it: what it means and what to do, in words; its own message under details.
String runProblem(String message) {
  final m = message.toLowerCase();
  if (RegExp(r'rate.?limit|429|too many requests').hasMatch(m)) {
    return 'The AI service is getting too many requests right now. Wait a minute, then ask AgentShot again.';
  }
  if (RegExp(r'overloaded|529|503|unavailable|capacity').hasMatch(m)) {
    return 'The AI service is overloaded right now. Ask AgentShot again in a moment.';
  }
  if (RegExp(
    r'\b50[024]\b|bad gateway|internal server error|gateway time-?out',
  ).hasMatch(m)) {
    return 'The AI service had a problem on its side. Ask AgentShot again in a moment.';
  }
  if (RegExp(r'credit|balance|402|quota|billing|insufficient').hasMatch(m)) {
    return 'There aren’t enough AI credits for AgentShot to carry on. Add credits, then ask again.';
  }
  if (RegExp(
    r'network|econn|fetch failed|timed? ?out|socket|enotfound',
  ).hasMatch(m)) {
    return 'The computer couldn’t reach the AI service. Check its internet connection, then ask AgentShot again.';
  }
  if (RegExp(r'api.?key|401|403|unauthori[sz]ed|forbidden').hasMatch(m)) {
    return 'The AI service didn’t accept the computer’s key. Check it in Settings on the computer.';
  }
  return 'AgentShot stopped before it finished. What it did so far is kept; ask again to carry on.';
}

/// A message from the computer, if it reads like a sentence for a person; otherwise [fallback]. A stack trace, a log
/// line, a path or an error code stays on the computer.
String readableOr(Object? text, String fallback) {
  final s = (text is String ? text : '').trim();
  if (s.isEmpty || s.length > 300 || s.contains('\n')) return fallback;
  final technical = RegExp(
    r'\b(error|exception)\s*:|\b(ENOENT|EACCES|EPERM|ECONNREFUSED|errno)\b|exit (code|status)|stack trace|\bat \S+\(|(^|\s)(/|[A-Za-z]:\\)\S+',
    caseSensitive: false,
  );
  return technical.hasMatch(s) ? fallback : s;
}

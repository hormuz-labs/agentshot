// A step the agent took, in words, as the computer words it (src/shared/steps.ts): for a computer on an older
// AgentShot that sends only the tool's name, the phone says it the same way.
import 'package:flutter/widgets.dart' show StringCharacters;
import '../bridge/client.dart';

String _tc(Object? s) {
  final t = s is num ? s.toDouble() : 0.0;
  final m = t ~/ 60;
  return '$m:${(t - m * 60).toStringAsFixed(1).padLeft(4, '0')}';
}

String _file(Object? p, String fallback) {
  final last = '${p ?? ''}'.split('/').last;
  return last.isEmpty ? fallback : last;
}

final _hasExt = RegExp(r'\.\w{2,4}$');
final _quotes = RegExp('^["\']|["\']\$');

/// A shell command as a sentence: a script's first comment, else what the command does, never the command itself.
String shellTitle(String command) {
  final c = command.trim();
  final lines = c.split('\n');
  final first = lines.first.trim().split(RegExp(r'\s+'));
  final word = first.first.split('/').last;
  if (RegExp(r'^(python3?|node|ruby|perl|bash|sh|zsh)$').hasMatch(word) && lines.length > 1) {
    for (final l in lines.skip(1)) {
      final m = RegExp(r'^\s*(?:#|//)\s*(.{4,})$').firstMatch(l);
      if (m != null) {
        final t = m.group(1)!.replaceFirst(RegExp(r"^let'?s\s+", caseSensitive: false), '');
        return t[0].toUpperCase() + t.substring(1);
      }
    }
    return 'Ran a small program';
  }
  final named = first.reversed
      .map((w) => w.replaceAll(_quotes, ''))
      .where(_hasExt.hasMatch)
      .firstOrNull
      ?.split('/')
      .last;
  if (word == 'ffmpeg') {
    return _hasExt.hasMatch(first.last) ? 'Made ${first.last.split('/').last}' : 'Worked on the video';
  }
  if (word == 'ffprobe') return named != null ? 'Checked $named' : 'Checked a file';
  if (word == 'curl') {
    final host = RegExp('https?://([^/\\s"\']+)').firstMatch(c)?.group(1);
    return host != null ? 'Fetched from $host' : 'Fetched something from the web';
  }
  if (word == 'bsk') return 'Used the browser';
  if (RegExp(r'^(ls|find|tree|du|stat)$').hasMatch(word)) return 'Looked through the project’s files';
  if (RegExp(r'^(cat|head|tail|less|wc|jq)$').hasMatch(word)) return named != null ? 'Read $named' : 'Read a file';
  if (RegExp(r'^(grep|rg|egrep|ag)$').hasMatch(word)) return named != null ? 'Searched $named' : 'Searched the files';
  if (RegExp(r'^(mkdir|cp|mv|rm|ln|touch|unzip|zip|tar)$').hasMatch(word)) return 'Tidied the project’s files';
  if (RegExp(r'^(python3?|node)$').hasMatch(word)) return 'Ran a small program';
  if (RegExp(r'^(pip3?|npm|brew|apt(-get)?)$').hasMatch(word)) return 'Set up a tool it needed';
  return 'Worked on the computer';
}

const _editWords = {
  'trim': ('trimmed a piece', 'trimmed # pieces'),
  'delete': ('removed a piece', 'removed # pieces'),
  'split': ('split a piece', 'made # splits'),
  'move': ('moved a piece', 'moved # pieces'),
  'insert': ('added a piece', 'added # pieces'),
  'level': ('changed a volume', 'changed # volumes'),
  'mix': ('changed the mix', 'changed the mix'),
  'speed': ('changed a speed', 'changed # speeds'),
};

String _editsTitle(List<Json> edits) {
  final counts = <String, int>{};
  for (final e in edits) {
    counts.update('${e['op']}', (n) => n + 1, ifAbsent: () => 1);
  }
  final said = [
    for (final MapEntry(:key, :value) in counts.entries)
      if (_editWords[key] case final w?) (value > 1 ? w.$2 : w.$1).replaceAll('#', '$value'),
  ];
  if (said.isEmpty) return edits.length > 1 ? 'Edited the cut (${edits.length} changes)' : 'Edited the cut';
  return 'Edited the cut: ${said.take(3).join(', ')}${said.length > 3 ? ', and more' : ''}';
}

String _walk(Json a) => switch (a['action']) {
  'start' => 'Started filming the walkthrough',
  'step' => a['title'] != null ? 'Step: ${a['title']}' : 'Next step',
  'type' => 'Typed “${'${a['text'] ?? ''}'.characters.take(40)}”',
  'scroll' => 'Scrolled',
  'move' => 'Moved the pointer',
  'pause' => 'Paused filming',
  'resume' => 'Filming again',
  'stop' => 'Stopped filming',
  _ => 'Filming the walkthrough',
};

/// A step, as a line: its own words when AgentShot knows the tool, else the tool's name in words.
String stepTitle(String name, Json a) {
  try {
    final args = a['args'] is List ? a['args'] as List : const [];
    return switch (name) {
      'sync_media' => 'Matching your screen and camera recordings',
      'analyze_screen_activity' => 'Finding screen actions and idle stretches',
      'compose_demo' => 'Syncing, cleaning and composing your demo',
      'walkthrough_record' => _walk(a),
      'compose_walkthrough' => 'Made the walkthrough',
      'set_camera_layout' => 'Adjusted your face-camera layout',
      'set_video_framing' => 'Adjusted video placement and framing',
      'project_state' => 'Looked at the project',
      'decide_version' => a['accept'] == true ? 'Used the preview as the editable version' : 'Rejected the preview',
      'probe' => 'Read ${_file(a['path'], 'a file')}',
      'ffmpeg' => args.isNotEmpty ? 'Made ${_file(args.last, 'the video')}' : 'Worked on the video',
      'propose_version' => 'Proposed “${a['title'] ?? 'a new cut'}”',
      'resolve_note' => a['reply'] != null ? 'Note: ${a['reply']}' : 'Resolved a note',
      'create_clip' => 'Made clip “${a['title'] ?? a['id']}”',
      'render_clip' => 'Re-rendered clip ${a['id']}',
      'insert_clip' => 'Inserted ${a['id']} at ${_tc(a['at'])}',
      'rerender_timeline' => 'Rendered the film',
      'transcript' => a['search'] != null ? 'Searched the transcript for “${a['search']}”' : 'Read the transcript',
      'seek' => 'Showed you ${_tc(a['t'])}',
      'bash' => shellTitle('${a['command'] ?? ''}'),
      'analyze_video' => 'Measured ${_file(a['media'], 'the video')}: shots, shake, exposure, colour, sound',
      'speakers' => 'Found who speaks when in ${_file(a['media'], 'the video')}',
      'find_subjects' => 'Found the faces and subjects${a['aspect'] != null ? ' for ${a['aspect']}' : ''}',
      'analyze_music' => 'Found the beat of ${_file(a['media'], 'the music')}',
      'look' => a['image'] != null
          ? 'Looked at ${_file(a['image'], 'a picture')}'
          : 'Looked at ${(a['times'] as List?)?.length ?? a['count'] ?? 6} frames${a['box'] != null ? ' (zoomed in)' : ''}',
      'read' => 'Read ${_file(a['path'], 'a file')}',
      'write' => 'Wrote ${_file(a['path'], 'a file')}',
      'edit' => 'Edited ${_file(a['path'], 'a file')}',
      'edit_timeline' => _editsTitle(objects(a['edits'])),
      'set_mix' => 'Adjusted the mix',
      'overlay_clip' => 'Laid ${a['id'] ?? 'a clip'} over the film${a['at'] != null ? ' at ${_tc(a['at'])}' : ''}',
      'generate_voice' => 'Recorded a voice-over',
      'generate_music' => 'Composed music',
      'export_video' => 'Exported the film',
      'import_media' => 'Brought in media',
      'name_speakers' => 'Named the speakers',
      'browser' => 'Used the browser',
      'ask_user' => 'Asked you',
      'memory' => 'Checked what it remembers',
      'remember' => 'Remembered something for next time',
      'forget' => 'Forgot something',
      'skills' => 'Looked at its skills',
      'demo_layout' => 'Laid out the demo',
      _ => name.replaceAll('_', ' '),
    };
  } catch (_) {
    return name.replaceAll('_', ' ');
  }
}

/// What a step shows under its details, besides its result: the command a shell step ran.
String? stepDetail(String name, Json a) {
  if (name == 'bash' && a['command'] != null) return '\$ ${a['command']}';
  if (name == 'ffmpeg' && a['args'] is List) return 'ffmpeg ${(a['args'] as List).join(' ')}';
  return null;
}

/// What a failed step means, in words anyone can follow (as the computer says it); the raw error stays under details.
String failureHint(String name, String result) {
  bool has(String pattern) => RegExp(pattern, caseSensitive: false).hasMatch(result);
  if (has('Accept or reject the proposed version first')) {
    return 'A new cut is waiting for you. Keep it or send it back, then the agent can carry on.';
  }
  if (name == 'bash' && result.contains('Operation not permitted')) {
    return 'That was outside the project’s folder, so it was blocked.';
  }
  if (has('was aborted|aborterror|stopped')) return 'This was stopped before it finished.';
  if (has('Unrecognized option|Option not found')) {
    return 'The tool didn’t understand how it was asked; the agent can try another way.';
  }
  if (has('invalid data found|moov atom not found|could not find codec')) {
    return 'That video file looks damaged or unfinished.';
  }
  if (has('ENOENT|no such file|not found|does not exist')) return 'That file isn’t in the project.';
  if (has('EACCES|permission denied')) return 'The computer didn’t allow access to that file.';
  if (has('ENOSPC|no space left')) return 'The computer ran out of disk space.';
  if (has('timed? ?out|ETIMEDOUT')) return 'This took too long and was stopped.';
  if (has('ECONNREFUSED|ENOTFOUND|network|fetch failed')) return 'The computer couldn’t reach the internet for this.';
  return 'This step didn’t work; the agent carries on without it.';
}

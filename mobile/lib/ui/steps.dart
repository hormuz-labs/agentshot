import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../bridge/client.dart';
import 'ask_card.dart';
import 'step_words.dart';
import 'mascot.dart';

/// One thing the agent did on the computer (a tool call): its title in words (from the computer, as the desktop shows
/// it), what it ran, and what came of it.
class Step {
  final String id, name, title;
  final String? detail;

  /// What it returned (or why it failed), once done.
  String? result;
  bool failed = false;

  /// For a failed one: what it means, in words.
  String? hint;
  Step(this.id, this.name, this.title, this.detail);

  bool get done => result != null || failed;
}

/// A turn's messages as the chat shows them: what was said, and between them the steps taken, folded.
sealed class ChatItem {}

class Said extends ChatItem {
  final Json message;
  Said(this.message);
}

class Steps extends ChatItem {
  final List<Step> steps;
  Steps(this.steps);
}

/// The agent asking the user something, with options to answer from; answered once a note follows it.
class Asked extends ChatItem {
  final String id;
  final List<Question> questions;
  bool answered = false;
  Asked(this.id, this.questions);
}

Json _json(Object? v) {
  if (v is Map) return object(v);
  try {
    final d = jsonDecode('${v ?? ''}');
    return d is Map ? object(d) : {};
  } catch (_) {
    return {};
  }
}

/// The conversation as said lines and runs of steps: each run of tool calls between two things said becomes one
/// "N steps" row, so the chat reads as the conversation, not the work behind it.
List<ChatItem> fold(List<Json> messages) {
  final out = <ChatItem>[];
  final byId = <String, Step>{};
  List<Step>? run;
  void flush() {
    if (run != null && run!.isNotEmpty) out.add(Steps(run!));
    run = null;
  }

  for (final m in messages) {
    switch (m['role']) {
      case 'user':
        flush();
        out.add(Said(m));
      case 'assistant':
        if ('${m['content'] ?? ''}'.trim().isNotEmpty) {
          flush();
          out.add(Said(m));
        }
        for (final c in objects(m['toolCalls'])) {
          final f = object(c['function'] ?? {});
          final name = '${f['name'] ?? 'step'}';
          if (name == 'ask_user') {
            flush();
            out.add(Asked('${c['id']}', Question.of(_json(f['arguments']))));
            continue;
          }
          final args = _json(f['arguments']);
          // the computer words each step; an older one doesn't, and the phone words it the same way
          final s = Step(
            '${c['id']}',
            name,
            c['title'] as String? ?? stepTitle(name, args),
            c['detail'] as String? ?? stepDetail(name, args),
          );
          byId[s.id] = s;
          (run ??= []).add(s);
        }
      case 'tool':
        final s = byId['${m['toolCallId']}'];
        if (s == null) continue;
        s.result = '${m['content'] ?? ''}';
        s.failed = m['error'] != null;
        s.hint =
            m['hint'] as String? ??
            (s.failed ? failureHint(s.name, s.result!) : null);
        // laying out a demo can come back with questions to settle first
        if (s.name == 'demo_layout' || s.name == 'compose_demo') {
          final asks = _json(s.result)['questions'];
          if (objects(asks).isNotEmpty) {
            flush();
            out.add(Asked(s.id, Question.of({'questions': asks})));
          }
        }
    }
  }
  flush();
  var later = false;
  for (final item in out.reversed) {
    if (item is Said && item.message['role'] == 'user') later = true;
    if (item is Asked) item.answered = later;
  }
  return out;
}

IconData _icon(String name) => switch (name) {
  'bash' => Icons.terminal,
  'read' || 'probe' => Icons.description_outlined,
  'write' || 'edit' => Icons.edit_outlined,
  'look' || 'project_state' => Icons.visibility_outlined,
  'analyze_video' ||
  'find_subjects' ||
  'analyze_screen_activity' => Icons.center_focus_strong_outlined,
  'transcript' ||
  'speakers' ||
  'analyze_music' ||
  'sync_media' => Icons.graphic_eq,
  'ffmpeg' ||
  'rerender_timeline' ||
  'compose_demo' ||
  'compose_walkthrough' => Icons.movie_creation_outlined,
  'create_clip' ||
  'render_clip' ||
  'insert_clip' => Icons.auto_awesome_outlined,
  'propose_version' || 'decide_version' => Icons.check_circle_outline,
  'walkthrough_record' => Icons.ads_click,
  'seek' => Icons.my_location,
  _ => Icons.build_outlined,
};

/// A run of steps in the chat. While it works: what it's doing now, then the last few steps done. Once done: one
/// line ("21 steps"), with any step that didn't work under it saying why; a tap opens every step, and a tap on a step
/// its command and output.
class StepsRow extends StatefulWidget {
  final List<Step> steps;

  /// Still going: what it's doing now.
  final String? now;
  const StepsRow({super.key, required this.steps, this.now});

  @override
  State<StepsRow> createState() => _StepsRowState();
}

class _StepsRowState extends State<StepsRow> {
  bool open = false;

  /// While it works, the steps done shown under what it's doing now.
  static const recent = 3;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ok = dark ? const Color(0xff7fcf8f) : const Color(0xff2e7d32);
    final steps = widget.steps;
    final now = widget.now;
    final failed = steps.where((s) => s.failed).toList();

    Widget line(Step s) => Padding(
      key: ValueKey('line-${s.id}'),
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 20,
            height: 20,
            child: s.failed
                ? Icon(Icons.close_rounded, size: 17, color: scheme.error)
                : Icon(Icons.check_rounded, size: 17, color: ok),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.title,
                  style: text.bodyMedium?.copyWith(
                    color: s.failed
                        ? scheme.onSurface
                        : scheme.onSurfaceVariant,
                  ),
                ),
                if (s.failed)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      s.hint ??
                          'This step didn’t work; the agent carries on without it.',
                      style: text.bodySmall?.copyWith(color: scheme.error),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );

    // a surface of its own (not a painted box), so the steps' taps show on it
    return Padding(
      key: const ValueKey('steps'),
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (now != null) ...[
                // what it's doing now, first, so it's seen without scrolling; then the latest done, newest first
                Row(
                  key: const ValueKey('steps-now'),
                  children: [
                    // Manul runs while the agent works
                    const Mascot(size: 30, busy: true),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '$now…'.replaceAll('……', '…'),
                        style: text.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                for (final s
                    in steps.reversed.where((s) => s.done).take(recent))
                  line(s),
              ] else ...[
                // done: one line, opened with a tap
                InkWell(
                  key: const ValueKey('steps-summary'),
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => setState(() => open = !open),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Icon(
                          failed.isEmpty
                              ? Icons.check_circle_outline_rounded
                              : Icons.error_outline_rounded,
                          size: 18,
                          color: failed.isEmpty ? ok : scheme.error,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            steps.length == 1
                                ? '1 step'
                                : '${steps.length} steps',
                            style: text.bodyMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                        Icon(
                          open
                              ? Icons.expand_less_rounded
                              : Icons.expand_more_rounded,
                          size: 20,
                          color: scheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),
                // what didn't work says why, even folded
                if (!open)
                  for (final s in failed) line(s),
                if (open)
                  for (final s in steps) StepTile(step: s),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class StepTile extends StatefulWidget {
  final Step step;
  const StepTile({super.key, required this.step});
  @override
  State<StepTile> createState() => _StepTileState();
}

class _StepTileState extends State<StepTile> {
  bool open = false;
  @override
  Widget build(BuildContext context) {
    final s = widget.step;
    final scheme = Theme.of(context).colorScheme;
    final more = s.detail != null || (s.result?.trim().isNotEmpty ?? false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          key: ValueKey('step-${s.id}'),
          dense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 8),
          leading: Icon(
            s.failed ? Icons.error_outline : _icon(s.name),
            size: 20,
            color: s.failed ? scheme.error : scheme.onSurfaceVariant,
          ),
          title: Text(
            s.title,
            maxLines: open ? 4 : 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: s.failed && s.hint != null
              ? Text(s.hint!, style: TextStyle(color: scheme.error))
              : !s.done
              ? const Text('Working…')
              : null,
          trailing: more
              ? Icon(
                  open ? Icons.expand_less : Icons.expand_more,
                  color: scheme.onSurfaceVariant,
                )
              : null,
          onTap: more ? () => setState(() => open = !open) : null,
        ),
        if (open) ...[
          if (s.detail != null) Output(label: 'Ran', text: s.detail!),
          if (s.result?.trim().isNotEmpty ?? false)
            Output(
              label: s.failed ? 'Error' : 'Result',
              text: s.result!.trim(),
            ),
        ],
      ],
    );
  }
}

/// Text from the computer, as it is: monospace, scrolled sideways rather than wrapped, with Copy.
class Output extends StatelessWidget {
  final String label, text;
  const Output({super.key, required this.label, required this.text});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(8, 0, 8, 10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 4, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ),
                IconButton(
                  tooltip: 'Copy',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.copy, size: 18),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: text));
                    ScaffoldMessenger.maybeOf(
                      context,
                    )?.showSnackBar(const SnackBar(content: Text('Copied')));
                  },
                ),
              ],
            ),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 260),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SelectableText(
                  text,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// AgentShot's problem with the AI service, as the turn ended on it: what it means and what to do, in words; its own message under details.
String runProblem(String message) {
  final m = message.toLowerCase();
  if (RegExp(r'rate.?limit|429|too many requests').hasMatch(m)) {
    return 'The AI service is getting too many requests right now. Wait a minute, then ask AgentShot again.';
  }
  if (RegExp(r'overloaded|529|503|unavailable|capacity').hasMatch(m)) {
    return 'The AI service is overloaded right now. Ask AgentShot again in a moment.';
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

class RunProblem extends StatefulWidget {
  final String message;
  const RunProblem({super.key, required this.message});
  @override
  State<RunProblem> createState() => _RunProblemState();
}

class _RunProblemState extends State<RunProblem> {
  bool details = false;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Container(
      key: const ValueKey('run-problem'),
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.error.withValues(alpha: .35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.error_outline_rounded, size: 20, color: scheme.error),
              const SizedBox(width: 10),
              Expanded(
                child: Text(runProblem(widget.message), style: text.bodyMedium),
              ),
            ],
          ),
          TextButton(
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              visualDensity: VisualDensity.compact,
              textStyle: text.labelMedium,
            ),
            onPressed: () => setState(() => details = !details),
            child: Text(details ? 'Hide details' : 'Show details'),
          ),
          if (details)
            Output(label: 'What the AI service said', text: widget.message),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import '../bridge/client.dart';

/// One thing the agent asks, with the options it offers (the first is the one it recommends).
class Question {
  final String question;
  final List<(String label, String? description)> options;
  final bool multiple;
  const Question(this.question, this.options, {this.multiple = false});

  /// The agent's ask_user arguments: one question with its options, or several questions together.
  static List<Question> of(Json args) {
    List<(String, String?)> opts(Object? list) => [
      for (final o in objects(list)) ('${o['label'] ?? ''}', o['description'] as String?),
    ];
    final many = objects(args['questions']);
    if (many.isNotEmpty) {
      return [for (final q in many) Question('${q['question'] ?? ''}', opts(q['options']), multiple: q['multiple'] == true)];
    }
    return [Question('${args['question'] ?? ''}', opts(args['options']), multiple: args['multiple'] == true)];
  }
}

/// What "You decide" sends: the agent goes with what it recommends.
const youDecide = 'You decide: use your recommendations.';

/// The message an answered card sends, worded as the desktop's (the agent reads the same either way).
String answerOf(List<Question> qs, List<List<String>> picks) {
  if (qs.length == 1 && !qs[0].multiple) return picks[0].firstOrNull ?? youDecide;
  if (qs.length == 1) return picks[0].isNotEmpty ? 'Apply: ${picks[0].join('; ')}' : 'None of these.';
  return [
    for (final (i, q) in qs.indexed) '${q.question} → ${picks[i].isNotEmpty ? picks[i].join(', ') : 'none'}',
  ].join('\n');
}

/// The agent's question in the conversation, answered right there: a tap for one plain question, ticks for a list
/// (all on to start), a pick per question for several; You decide always; or a typed answer instead.
class AskCard extends StatefulWidget {
  final List<Question> questions;

  /// Answered already (a note came after it): shown, not to be answered again.
  final bool answered;
  final ValueChanged<String> onAnswer;
  const AskCard({super.key, required this.questions, required this.answered, required this.onAnswer});
  @override
  State<AskCard> createState() => _AskCardState();
}

class _AskCardState extends State<AskCard> {
  late List<Question> qs = widget.questions;
  // one choice starts on the recommended (first) option; a lone checklist starts all ticked
  late final picks = [
    for (final q in qs)
      q.multiple
          ? (qs.length == 1 ? q.options.map((o) => o.$1).toList() : <String>[])
          : q.options.take(1).map((o) => o.$1).toList(),
  ];
  bool get quick => qs.length == 1 && !qs[0].multiple;

  void pick(int qi, String label) => setState(() {
    final p = picks[qi];
    if (!qs[qi].multiple) {
      p
        ..clear()
        ..add(label);
    } else if (!p.remove(label)) {
      p.add(label);
    }
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final done = widget.answered;
    return Container(
      key: const ValueKey('ask'),
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
      decoration: BoxDecoration(
        color: done ? scheme.surfaceContainerLow : scheme.primaryContainer.withValues(alpha: .35),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: done ? scheme.outlineVariant : scheme.primary.withValues(alpha: .4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (qi, q) in qs.indexed) ...[
            Text(q.question, style: text.titleSmall),
            const SizedBox(height: 8),
            if (quick)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final (label, about) in q.options)
                    OutlinedButton(
                      onPressed: done ? null : () => widget.onAnswer(label),
                      child: about == null ? Text(label) : Tooltip(message: about, child: Text(label)),
                    ),
                ],
              )
            else if (q.multiple)
              for (final (label, about) in q.options)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: picks[qi].contains(label),
                  onChanged: done ? null : (_) => pick(qi, label),
                  title: Text(label),
                  subtitle: about == null ? null : Text(about),
                )
            else ...[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final (label, _) in q.options)
                    ChoiceChip(
                      label: Text(label),
                      selected: picks[qi].contains(label),
                      onSelected: done ? null : (_) => pick(qi, label),
                    ),
                ],
              ),
              if (q.options.where((o) => picks[qi].contains(o.$1)).firstOrNull?.$2 case final about?)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(about, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                ),
            ],
            const SizedBox(height: 10),
          ],
          if (!done)
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (!quick)
                  FilledButton(
                    onPressed: qs.length == 1 && picks[0].isEmpty ? null : () => widget.onAnswer(answerOf(qs, picks)),
                    child: Text(
                      qs.length == 1
                          ? 'Apply ${picks[0].length == qs[0].options.length ? 'all' : picks[0].length}'
                          : 'Go',
                    ),
                  ),
                if (!quick && qs.length == 1)
                  TextButton(onPressed: () => widget.onAnswer('None of these.'), child: const Text('None')),
                TextButton(onPressed: () => widget.onAnswer(youDecide), child: const Text('You decide')),
                Text(
                  'or type your own answer',
                  style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

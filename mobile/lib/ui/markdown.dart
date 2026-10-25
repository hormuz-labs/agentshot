import 'package:flutter/material.dart';

/// The agent's replies, as Markdown: headings, paragraphs, bullet and numbered lists, code blocks, and inline bold,
/// italics, `code` and links. Just what the agent writes; anything else shows as plain text.
class Markdown extends StatelessWidget {
  final String text;
  const Markdown(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final body = theme.textTheme.bodyLarge!.copyWith(height: 1.45);
    final code = TextStyle(
      fontFamily: 'monospace',
      fontSize: (body.fontSize ?? 16) * .88,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
    );
    final blocks = <Widget>[];
    final lines = text.replaceAll('\r', '').split('\n');
    final paragraph = <String>[];

    void flush() {
      if (paragraph.isEmpty) return;
      blocks.add(
        Text.rich(
          TextSpan(children: inline(paragraph.join('\n'), body, code)),
          style: body,
        ),
      );
      paragraph.clear();
    }

    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      final trimmed = line.trimLeft();
      if (trimmed.startsWith('```')) {
        flush();
        final fenced = <String>[];
        while (++i < lines.length && !lines[i].trimLeft().startsWith('```')) {
          fenced.add(lines[i]);
        }
        blocks.add(
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Text(
                fenced.join('\n'),
                style: code.copyWith(backgroundColor: Colors.transparent),
              ),
            ),
          ),
        );
        continue;
      }
      final heading = RegExp(r'^(#{1,6})\s+(.*)$').firstMatch(trimmed);
      final bullet = RegExp(r'^[-*•]\s+(.*)$').firstMatch(trimmed);
      final numbered = RegExp(r'^(\d+)[.)]\s+(.*)$').firstMatch(trimmed);
      if (trimmed.isEmpty) {
        flush();
      } else if (heading != null) {
        flush();
        final level = heading.group(1)!.length;
        final style =
            (level <= 2
                    ? theme.textTheme.titleLarge
                    : theme.textTheme.titleMedium)!
                .copyWith(fontWeight: FontWeight.w600);
        blocks.add(
          Text.rich(
            TextSpan(children: inline(heading.group(2)!, style, code)),
            style: style,
          ),
        );
      } else if (bullet != null || numbered != null) {
        flush();
        final indent = (line.length - trimmed.length) ~/ 2;
        blocks.add(
          Padding(
            padding: EdgeInsets.only(left: 4.0 + indent * 16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: numbered != null ? 26 : 18,
                  child: Text(
                    numbered != null ? '${numbered.group(1)}.' : '•',
                    style: body,
                  ),
                ),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      children: inline(
                        (bullet ?? numbered)!.group(bullet != null ? 1 : 2)!,
                        body,
                        code,
                      ),
                    ),
                    style: body,
                  ),
                ),
              ],
            ),
          ),
        );
      } else {
        paragraph.add(line);
      }
    }
    flush();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (i, b) in blocks.indexed) ...[
          if (i > 0) const SizedBox(height: 10),
          b,
        ],
      ],
    );
  }

  /// **bold**, *italics* or _italics_, `code` and [links](url) within a line.
  static List<InlineSpan> inline(String text, TextStyle base, TextStyle code) {
    final spans = <InlineSpan>[];
    final pattern = RegExp(
      r'`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|_(\S(?:.*?\S)?)_|\[([^\]]+)\]\(([^)]+)\)',
    );
    var at = 0;
    for (final m in pattern.allMatches(text)) {
      if (m.start > at) spans.add(TextSpan(text: text.substring(at, m.start)));
      if (m.group(1) != null) {
        spans.add(TextSpan(text: ' ${m.group(1)} ', style: code));
      } else if (m.group(2) != null || m.group(3) != null) {
        spans.add(
          TextSpan(
            children: inline(m.group(2) ?? m.group(3)!, base, code),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        );
      } else if (m.group(4) != null || m.group(5) != null) {
        spans.add(
          TextSpan(
            text: m.group(4) ?? m.group(5),
            style: const TextStyle(fontStyle: FontStyle.italic),
          ),
        );
      } else {
        spans.add(
          TextSpan(
            text: m.group(6),
            style: TextStyle(
              decoration: TextDecoration.underline,
              color: base.color,
            ),
          ),
        );
      }
      at = m.end;
    }
    if (at < text.length) spans.add(TextSpan(text: text.substring(at)));
    return spans;
  }
}

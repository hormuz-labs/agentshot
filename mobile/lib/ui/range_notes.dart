import 'package:flutter/material.dart';

class RangeDraft {
  double start, end;
  String text;
  RangeDraft(this.start, this.end, [this.text = '']);
}

String appendRange(String text, double start, double end) =>
    '${text.trimRight()}${text.trim().isEmpty ? '' : '\n'}From ${start.toStringAsFixed(3)}s to ${end.toStringAsFixed(3)}s: ';

final rangeMarker = RegExp(
  r'^(?:(?:Note · )?From (\d+(?:\.\d+)?)s to (\d+(?:\.\d+)?)s:|(\d+(?:\.\d+)?):(\d+(?:\.\d+)?))(?=\s|$)',
  multiLine: true,
);

/// Keeps the draft as ordinary editable text while making selected timestamps stand out.
class RangeTextController extends TextEditingController {
  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    final children = <InlineSpan>[];
    var end = 0;
    // Preserve the platform's composing underline while an IME is active.
    if (withComposing &&
        value.isComposingRangeValid &&
        !value.composing.isCollapsed) {
      return super.buildTextSpan(
        context: context,
        style: style,
        withComposing: withComposing,
      );
    }
    for (final m in rangeMarker.allMatches(text)) {
      children.add(TextSpan(text: text.substring(end, m.start)));
      children.add(
        TextSpan(
          text: m[0],
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            backgroundColor: Color(0xFFF97316),
            color: Colors.black,
          ),
        ),
      );
      end = m.end;
    }
    children.add(TextSpan(text: text.substring(end)));
    return TextSpan(style: style, children: children);
  }
}

List<RangeDraft> draftRanges(String text) => rangeMarker
    .allMatches(text)
    .map(
      (m) => RangeDraft(
        double.parse((m[1] ?? m[3])!),
        double.parse((m[2] ?? m[4])!),
      ),
    )
    .toList();

/// Tap to seek; drag in either direction to append a range. A cancelled gesture adds nothing.
class RangeTimeline extends StatefulWidget {
  final double duration, position;
  final List<RangeDraft> notes;
  final ValueChanged<double> onSeek;
  final void Function(double start, double end) onRange;
  const RangeTimeline({
    super.key,
    required this.duration,
    required this.position,
    required this.notes,
    required this.onSeek,
    required this.onRange,
  });
  @override
  State<RangeTimeline> createState() => _RangeTimelineState();
}

class _RangeTimelineState extends State<RangeTimeline> {
  double? start, end;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, size) {
      final duration = widget.duration;
      final enabled = duration.isFinite && duration > 0 && size.maxWidth > 0;
      double at(double x) => (x / size.maxWidth).clamp(0.0, 1.0) * duration;
      final color = Theme.of(context).colorScheme.primary;
      return Semantics(
        label: 'Video timeline. Tap to seek, drag to select a range',
        child: Listener(
          onPointerCancel: (_) {
            start = null;
            end = null;
          },
          child: GestureDetector(
            key: const ValueKey('range-timeline'),
            behavior: HitTestBehavior.opaque,
            onTapUp: !enabled
                ? null
                : (d) => widget.onSeek(at(d.localPosition.dx)),
            onHorizontalDragDown: !enabled
                ? null
                : (d) => setState(() {
                    start = at(d.localPosition.dx);
                    end = start;
                  }),
            onHorizontalDragUpdate: !enabled
                ? null
                : (d) => setState(() => end = at(d.localPosition.dx)),
            onHorizontalDragCancel: () => setState(() {
              start = null;
              end = null;
            }),
            onHorizontalDragEnd: !enabled
                ? null
                : (_) {
                    if (start != null &&
                        end != null &&
                        (end! - start!).abs() >= .001) {
                      widget.onRange(
                        start! < end! ? start! : end!,
                        start! < end! ? end! : start!,
                      );
                    }
                    setState(() {
                      start = null;
                      end = null;
                    });
                  },
            child: SizedBox(
              height: 56,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: .08),
                        border: Border.all(color: color),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                  if (enabled) ...[
                    for (final range in [
                      ...widget.notes
                          .where(
                            (n) =>
                                n.start.isFinite &&
                                n.end.isFinite &&
                                n.end > n.start,
                          )
                          .map((n) => (n.start, n.end)),
                      if (start != null && end != null)
                        (
                          start! < end! ? start! : end!,
                          start! < end! ? end! : start!,
                        ),
                    ])
                      Positioned(
                        left:
                            range.$1.clamp(0, duration) /
                            duration *
                            size.maxWidth,
                        width:
                            (range.$2.clamp(0, duration) -
                                range.$1.clamp(0, duration)) /
                            duration *
                            size.maxWidth,
                        top: 0,
                        bottom: 0,
                        child: ColoredBox(color: color.withValues(alpha: .3)),
                      ),
                    Positioned(
                      left:
                          widget.position.clamp(0, duration) /
                          duration *
                          (size.maxWidth - 2),
                      top: 0,
                      bottom: 0,
                      child: Container(width: 2, color: color),
                    ),
                  ],
                  const Center(child: Text('Drag to add an edit')),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}

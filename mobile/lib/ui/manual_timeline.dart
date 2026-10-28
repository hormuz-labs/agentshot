import 'package:flutter/material.dart';
import '../bridge/client.dart';

/// Manual clip editing on both phones: drag the grip to reorder, tap a clip for its tools.
class ManualTimeline extends StatelessWidget {
  final List<Json> items;
  final Json media, clips;
  final double Function() position;
  final double fps;
  final Future<void> Function(Json) onEdit;
  const ManualTimeline({
    super.key,
    required this.items,
    required this.media,
    required this.clips,
    required this.position,
    required this.fps,
    required this.onEdit,
  });

  double length(Json item) => item['kind'] == 'media'
      ? (item['out'] as num).toDouble() - (item['in'] as num).toDouble()
      : (item['dur'] as num).toDouble();

  Future<void> actions(BuildContext context, Json item, double start) async {
    final from = item['kind'] == 'media' ? (item['in'] as num).toDouble() : 0.0;
    final to = item['kind'] == 'media'
        ? (item['out'] as num).toDouble()
        : length(item);
    final max =
        ((item['kind'] == 'media'
                    ? media[item['src']]
                    : clips[item['clip']])?['duration']
                as num?)
            ?.toDouble() ??
        to;
    final index = items.indexOf(item);
    final playhead = position();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _ClipSheet(
        item: item,
        from: from,
        to: to,
        maximum: max,
        minimum: (1 / fps).clamp(.04, 1),
        canSplit:
            item['kind'] == 'media' &&
            playhead > start + .001 &&
            playhead < start + length(item) - .001,
        position: playhead,
        items: items,
        index: index,
        onEdit: onEdit,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        'Manual timeline · tap a clip for tools, hold its grip to move',
      ),
      const SizedBox(height: 8),
      SizedBox(
        height: 92,
        child: ReorderableListView.builder(
          key: const ValueKey('manual-timeline'),
          scrollDirection: Axis.horizontal,
          buildDefaultDragHandles: false,
          itemCount: items.length,
          // Keep compatibility with the repository's Flutter 3.41-era toolchain.
          // ignore: deprecated_member_use
          onReorder: (old, next) async {
            final remaining = [...items]..removeAt(old);
            final target = next > old ? next - 1 : next;
            try {
              await onEdit({
                'op': 'move',
                'id': items[old]['id'],
                if (target < remaining.length)
                  'before': remaining[target]['id'],
              });
            } catch (e) {
              if (context.mounted) {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text('$e')));
              }
            }
          },
          itemBuilder: (context, i) {
            final item = items[i];
            final start = items
                .take(i)
                .fold<double>(0, (sum, it) => sum + length(it));
            return SizedBox(
              key: ValueKey('manual-${item['id']}'),
              width: 180,
              child: Card(
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => actions(context, item, start),
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      children: [
                        ReorderableDelayedDragStartListener(
                          index: i,
                          child: const Padding(
                            padding: EdgeInsets.all(8),
                            child: Icon(Icons.drag_indicator),
                          ),
                        ),
                        Expanded(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${item['src'] ?? item['clip']}'
                                    .split('/')
                                    .last,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                '${start.toStringAsFixed(2)}–${(start + length(item)).toStringAsFixed(2)}s',
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    ],
  );
}

class _ClipSheet extends StatefulWidget {
  final Json item;
  final List<Json> items;
  final int index;
  final double from, to, maximum, minimum, position;
  final bool canSplit;
  final Future<void> Function(Json) onEdit;
  const _ClipSheet({
    required this.item,
    required this.items,
    required this.index,
    required this.from,
    required this.to,
    required this.maximum,
    required this.minimum,
    required this.position,
    required this.canSplit,
    required this.onEdit,
  });
  @override
  State<_ClipSheet> createState() => _ClipSheetState();
}

class _ClipSheetState extends State<_ClipSheet> {
  late final from = TextEditingController(text: widget.from.toStringAsFixed(3));
  late final to = TextEditingController(text: widget.to.toStringAsFixed(3));
  bool busy = false;
  String? error;
  @override
  void dispose() {
    from.dispose();
    to.dispose();
    super.dispose();
  }

  Future<void> run(Json edit) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.onEdit(edit);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() {
          error = '$e';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = double.tryParse(from.text), b = double.tryParse(to.text);
    final valid =
        a != null &&
        b != null &&
        a.isFinite &&
        b.isFinite &&
        a >= 0 &&
        b - a >= widget.minimum - .00001 &&
        b <= widget.maximum;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Clip actions',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  tooltip: 'Close clip actions',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const Text(
              'Trim source seconds. Drag the handles or enter exact times.',
            ),
            if (valid && widget.item['kind'] == 'media')
              RangeSlider(
                values: RangeValues(a, b),
                max: widget.maximum,
                labels: RangeLabels(
                  '${a.toStringAsFixed(3)}s',
                  '${b.toStringAsFixed(3)}s',
                ),
                onChanged: busy
                    ? null
                    : (v) {
                        if (v.end - v.start < widget.minimum) return;
                        setState(() {
                          from.text = v.start.toStringAsFixed(3);
                          to.text = v.end.toStringAsFixed(3);
                        });
                      },
              ),
            Row(
              children: [
                if (widget.item['kind'] == 'media')
                  Expanded(
                    child: TextField(
                      controller: from,
                      enabled: !busy,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Trim start seconds',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: to,
                    enabled: !busy,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Trim end seconds',
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  onPressed: busy || !valid
                      ? null
                      : () => run({
                          'op': 'trim',
                          'id': widget.item['id'],
                          if (widget.item['kind'] == 'media') 'in': a,
                          'out': b,
                        }),
                  child: const Text('Apply trim'),
                ),
                OutlinedButton(
                  onPressed: busy || !widget.canSplit
                      ? null
                      : () => run({'op': 'split', 'at': widget.position}),
                  child: const Text('Split at playhead'),
                ),
                OutlinedButton(
                  onPressed: busy || widget.items.length < 2
                      ? null
                      : () => run({
                          'op': 'delete',
                          'ids': [widget.item['id']],
                        }),
                  child: const Text('Remove clip'),
                ),
                OutlinedButton(
                  onPressed: busy || widget.index == 0
                      ? null
                      : () => run({
                          'op': 'move',
                          'id': widget.item['id'],
                          'before': widget.items[widget.index - 1]['id'],
                        }),
                  child: const Text('Move earlier'),
                ),
                OutlinedButton(
                  onPressed: busy || widget.index == widget.items.length - 1
                      ? null
                      : () => run({
                          'op': 'move',
                          'id': widget.item['id'],
                          if (widget.index + 2 < widget.items.length)
                            'before': widget.items[widget.index + 2]['id'],
                        }),
                  child: const Text('Move later'),
                ),
              ],
            ),
            if (error != null)
              Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      ),
    );
  }
}

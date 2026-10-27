import 'package:flutter/material.dart';
import '../bridge/store.dart';
import 'player.dart';

/// How an attachment reads in the composer: the file's name, and for a marked part its times (file.mp4#t=4.2,9).
String attachmentLabel(String ref) {
  final m = RegExp(r'^(.+)#t=([\d.]+),([\d.]+)$').firstMatch(ref);
  final name = (m?.group(1) ?? ref).split('/').last;
  if (m == null) return name;
  // a long name is cut in the middle, so the part's times always show
  final dot = name.lastIndexOf('.');
  final short = name.length <= 18 || dot < 1 ? name : '${name.substring(0, 10)}…${name.substring(dot)}';
  return '$short · ${clock(double.parse(m.group(2)!))}–${clock(double.parse(m.group(3)!))}';
}

/// 0:04.2
String clock(double s) =>
    '${s ~/ 60}:${(s % 60).toStringAsFixed(1).padLeft(4, '0')}';

/// A project file, opened: a video or sound plays, a photo shows. From here it goes into the next note whole, or (for
/// what plays) just the parts marked on it, each its own start and end, so the note can say what to do with each.
/// Pops with what to attach.
class FileView extends StatefulWidget {
  final BridgeStore store;
  final String dir, rel, kind;

  /// What the phone plays for it (its lighter preview copy when there is one).
  final String play;
  const FileView({
    super.key,
    required this.store,
    required this.dir,
    required this.rel,
    required this.kind,
    required this.play,
  });
  @override
  State<FileView> createState() => _FileViewState();
}

class _FileViewState extends State<FileView> {
  double position = 0;
  double? from;
  final parts = <(double, double)>[];
  bool get plays => widget.kind == 'video' || widget.kind == 'audio';

  void mark() => setState(() {
    final start = from;
    if (start == null) {
      from = position;
      return;
    }
    final (a, b) = start <= position ? (start, position) : (position, start);
    if (b - a >= .2) parts.add((a, b));
    from = null;
  });

  List<String> get chosen => parts.isEmpty
      ? [widget.rel]
      : [
          for (final (a, b) in parts)
            '${widget.rel}#t=${a.toStringAsFixed(1)},${b.toStringAsFixed(1)}',
        ];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.rel.split('/').last, overflow: TextOverflow.ellipsis),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: ColoredBox(
              color: Colors.black,
              child: plays
                  ? RemotePlayer(
                      key: ValueKey('view-${widget.rel}'),
                      uri: () => widget.store.client.media(widget.dir, widget.play),
                      onPosition: (t) => position = t,
                    )
                  : FutureBuilder<Uri>(
                      future: widget.store.client.media(widget.dir, widget.rel),
                      builder: (context, uri) => uri.data == null
                          ? const AspectRatio(
                              aspectRatio: 4 / 3,
                              child: Center(child: CircularProgressIndicator()),
                            )
                          : InteractiveViewer(
                              maxScale: 6,
                              child: Image.network(
                                '${uri.data}',
                                key: const ValueKey('view-image'),
                                fit: BoxFit.contain,
                                errorBuilder: (_, _, _) => const Padding(
                                  padding: EdgeInsets.all(32),
                                  child: Text(
                                    'Couldn’t show this picture here.',
                                    style: TextStyle(color: Colors.white),
                                  ),
                                ),
                              ),
                            ),
                    ),
            ),
          ),
          if (plays) ...[
            const SizedBox(height: 16),
            Text('Point at parts', style: text.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Play to where a part starts and tap Start here, then to where it ends and tap End here. Mark as many as you like; your note can say what to do with each.',
              style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton.icon(
                  key: const ValueKey('mark'),
                  onPressed: mark,
                  icon: Icon(from == null ? Icons.start_rounded : Icons.last_page_rounded),
                  label: Text(from == null ? 'Start here' : 'End here'),
                ),
                if (from case final f?)
                  InputChip(
                    label: Text('From ${clock(f)}…'),
                    onDeleted: () => setState(() => from = null),
                  ),
                for (final (i, (a, b)) in parts.indexed)
                  InputChip(
                    key: ValueKey('part-$i'),
                    avatar: const Icon(Icons.content_cut_rounded, size: 16),
                    label: Text('${clock(a)}–${clock(b)}'),
                    onDeleted: () => setState(() => parts.removeAt(i)),
                  ),
              ],
            ),
          ],
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton.icon(
            key: const ValueKey('add-to-chat'),
            onPressed: () => Navigator.pop(context, chosen),
            icon: const Icon(Icons.add_comment_outlined),
            label: Text(
              parts.isEmpty
                  ? 'Add to chat'
                  : 'Add ${parts.length == 1 ? 'this part' : '${parts.length} parts'} to chat',
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../bridge/client.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'player.dart';

/// A cut in the conversation, as a chat app shows an attachment: watch it right there (it loads only when tapped),
/// and download it (it comes to this phone and opens the share sheet, to save or send), without going to the Film
/// tab. [actions] go beside Download (Keep and Send back for a new cut).
class CutCard extends StatefulWidget {
  final BridgeStore store;
  final String dir;

  /// The cut: its id, title and path (the film as rendered, which Download fetches).
  final Json version;

  /// What the preview plays: the cut's lighter proxy when there is one.
  final String play;
  final String headline;
  final bool highlight;
  final List<Widget> actions;
  const CutCard({
    super.key,
    required this.store,
    required this.dir,
    required this.version,
    required this.play,
    required this.headline,
    this.highlight = false,
    this.actions = const [],
  });
  @override
  State<CutCard> createState() => _CutCardState();
}

class _CutCardState extends State<CutCard> {
  bool playing = false;

  /// Download progress, 0 to 1, while it comes.
  double? progress;

  @override
  void didUpdateWidget(CutCard old) {
    super.didUpdateWidget(old);
    // another cut: back to its cover
    if (old.version['id'] != widget.version['id']) playing = false;
  }

  Future<void> download() async {
    setState(() => progress = 0);
    try {
      await guard(context, () async {
        final file = await widget.store.client.download(
          widget.dir,
          widget.version['path'] as String,
          progress: (v) {
            if (mounted) setState(() => progress = v);
          },
        );
        if (!mounted) return;
        final box = context.findRenderObject() as RenderBox?;
        await SharePlus.instance.share(
          ShareParams(
            files: [XFile(file.path)],
            title: '${widget.version['title'] ?? 'Your film'}',
            sharePositionOrigin: box == null
                ? null
                : box.localToGlobal(Offset.zero) & box.size,
          ),
        );
      });
    } finally {
      if (mounted) setState(() => progress = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final title = widget.version['title'];
    return Container(
      key: ValueKey('cut-${widget.version['id']}'),
      margin: const EdgeInsets.only(bottom: 18),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: widget.highlight
            ? scheme.primaryContainer.withValues(alpha: .45)
            : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: widget.highlight
              ? scheme.primary.withValues(alpha: .25)
              : scheme.outlineVariant,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // the film itself: a cover to tap, then the player in its place
          if (playing)
            ColoredBox(
              color: Colors.black,
              child: RemotePlayer(
                key: ValueKey('cut-player-${widget.play}'),
                uri: () => widget.store.client.media(widget.dir, widget.play),
              ),
            )
          else
            Semantics(
              button: true,
              label: 'Play the cut here',
              child: InkWell(
                key: const ValueKey('cut-play'),
                onTap: () => setState(() => playing = true),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: DecoratedBox(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xff1d1a17), Color(0xff3a2c16)],
                      ),
                    ),
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .92),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.play_arrow_rounded,
                          size: 34,
                          color: Color(0xff1d1a17),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.headline, style: text.titleSmall),
                if (title != null)
                  Text(
                    '$title',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    ...widget.actions,
                    OutlinedButton.icon(
                      key: const ValueKey('cut-download'),
                      onPressed: progress == null ? download : null,
                      icon: progress == null
                          ? const Icon(Icons.download_rounded)
                          : SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                value: progress! > 0 ? progress : null,
                              ),
                            ),
                      label: Text(
                        progress == null
                            ? 'Download'
                            : 'Downloading ${(progress! * 100).round()}%',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

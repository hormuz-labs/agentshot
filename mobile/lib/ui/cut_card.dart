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
    final cover = Semantics(
      button: true,
      label: 'Play the cut here',
      child: InkWell(
        key: const ValueKey('cut-play'),
        borderRadius: BorderRadius.circular(12),
        onTap: () => setState(() => playing = true),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            width: 120,
            height: 68,
            child: Stack(
              fit: StackFit.expand,
              children: [
                // the cut's own first frame, when the computer has it
                FutureBuilder<Uri>(
                  future: widget.store.client.thumbnail(
                    widget.dir,
                    widget.version['path'] as String,
                  ),
                  builder: (context, uri) => DecoratedBox(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xff1d1a17), Color(0xff3a2c16)],
                      ),
                    ),
                    child: uri.data == null
                        ? null
                        : Image.network(
                            '${uri.data}',
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => const SizedBox(),
                          ),
                  ),
                ),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .9),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.play_arrow_rounded,
                      size: 20,
                      color: Color(0xff1d1a17),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    final compact = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(0, 36)),
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 14),
      ),
      visualDensity: VisualDensity.compact,
      textStyle: WidgetStatePropertyAll(text.labelLarge),
      iconSize: const WidgetStatePropertyAll(18),
    );
    return Container(
      key: ValueKey('cut-${widget.version['id']}'),
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: widget.highlight
            ? scheme.primaryContainer.withValues(alpha: .3)
            : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: widget.highlight
              ? scheme.primary.withValues(alpha: .3)
              : scheme.outlineVariant,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // the cut, small; tapped, it plays here full width
          if (playing)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: ColoredBox(
                color: Colors.black,
                child: RemotePlayer(
                  key: ValueKey('cut-player-${widget.play}'),
                  uri: () => widget.store.client.media(widget.dir, widget.play),
                ),
              ),
            ),
          if (playing) const SizedBox(height: 8),
          Row(
            children: [
              if (!playing) ...[cover, const SizedBox(width: 12)],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.headline, style: text.titleSmall),
                    if (title != null)
                      Text(
                        '$title',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
              IconButton(
                key: const ValueKey('cut-download'),
                tooltip: progress == null
                    ? 'Download'
                    : 'Downloading ${(progress! * 100).round()}%',
                onPressed: progress == null ? download : null,
                icon: progress == null
                    ? const Icon(Icons.download_rounded)
                    : SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          value: progress! > 0 ? progress : null,
                        ),
                      ),
              ),
            ],
          ),
          if (widget.actions.isNotEmpty) ...[
            const SizedBox(height: 10),
            Theme(
              data: Theme.of(context).copyWith(
                filledButtonTheme: FilledButtonThemeData(style: compact),
                textButtonTheme: TextButtonThemeData(style: compact),
                outlinedButtonTheme: OutlinedButtonThemeData(style: compact),
              ),
              child: Wrap(
                spacing: 4,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: widget.actions,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

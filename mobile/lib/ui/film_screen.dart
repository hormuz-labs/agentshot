import 'dart:async';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../bridge/client.dart';
import 'common.dart';
import 'design.dart';
import 'import.dart' show OptionRow;

/// What the person chose on the film, for the project screen to carry out: a note at a moment (or on a box there),
/// one of the project's actions, or a decision on a new cut. [position] is where the film was, in seconds.
class FilmChoice {
  final String what;
  final double position;
  final Json? box;
  const FilmChoice(this.what, this.position, {this.box});
}

/// The film, filling the screen as a reel: tap to play or pause, the scrubber at the bottom, and what can be done
/// with it floating down the right (Note, Box, Range, Timeline, Share, More). A new cut waiting ([proposal]) adds
/// Before / After at the top and Keep / Send back at the bottom. Swipe down, or the chevron, to go back.
class FilmScreen extends StatefulWidget {
  /// The film as kept, and the new cut when one waits: where each plays from.
  final Future<Uri> Function() film;
  final Future<Uri> Function()? proposal;
  final double startAt;

  /// Starts on the new cut (After) rather than the film as kept.
  final bool showAfter;

  /// The project's ⋯ menu: each (key, name, icon); the key comes back as [FilmChoice.what].
  final List<(String, String, IconData)> menu;
  const FilmScreen({
    super.key,
    required this.film,
    this.proposal,
    this.startAt = 0,
    this.showAfter = true,
    this.menu = const [],
  });

  @override
  State<FilmScreen> createState() => _FilmScreenState();
}

class _FilmScreenState extends State<FilmScreen> {
  VideoPlayerController? controller;
  String? error;
  late bool after = widget.proposal != null && widget.showAfter;

  /// Drawing a box on the picture, and where it's drawn so far (0–1 of the picture).
  bool boxing = false;
  Offset? from, to;

  /// How far it's been dragged down (to close).
  double pulled = 0;

  @override
  void initState() {
    super.initState();
    _load(widget.startAt, play: true);
  }

  Future<void> _load(double at, {bool play = false}) async {
    final old = controller;
    VideoPlayerController? next;
    try {
      final uri = await (after ? widget.proposal! : widget.film)();
      if (!mounted) return;
      next = VideoPlayerController.networkUrl(uri);
      await next.initialize();
      if (!mounted) {
        await next.dispose();
        return;
      }
      await next.seekTo(Duration(milliseconds: (at * 1000).round()));
      if (play) await next.play();
      setState(() {
        controller = next?..addListener(_tick);
        error = null;
      });
      old?.removeListener(_tick);
      await old?.dispose();
    } catch (e) {
      await next?.dispose();
      if (mounted) setState(() => error = 'Couldn’t play this here. ${plain(e)}');
    }
  }

  void _tick() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    controller?.removeListener(_tick);
    controller?.dispose();
    super.dispose();
  }

  double get position => (controller?.value.position.inMilliseconds ?? 0) / 1000;

  void toggle() {
    final c = controller;
    if (c == null) return;
    c.value.isPlaying ? c.pause() : c.play();
  }

  /// Back to the conversation with [what] to do there (the film paused where it was).
  void choose(String what, {Json? box}) {
    controller?.pause();
    Navigator.pop(context, FilmChoice(what, position, box: box));
  }

  Future<void> more() async {
    controller?.pause();
    final key = await showSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (key, name, icon) in widget.menu)
              OptionRow(icon: icon, title: name, onTap: () => Navigator.pop(sheet, key)),
          ],
        ),
      ),
    );
    if (key != null && mounted) choose(key);
  }

  /// One of the floating controls: an icon on a dark glass circle, its word under it.
  Widget rail(IconData icon, String label, VoidCallback? onTap, {bool on = false, Key? key}) => Semantics(
    button: true,
    label: label,
    child: GestureDetector(
      key: key,
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: on ? Studio.of(context).accent : Colors.black.withValues(alpha: .4),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 22, color: on ? Studio.of(context).onAccent : Colors.white),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Colors.white,
                shadows: const [Shadow(blurRadius: 4, color: Colors.black54)],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    final playing = c?.value.isPlaying ?? false;
    final duration = (c?.value.duration.inMilliseconds ?? 0).toDouble();
    final at = (c?.value.position.inMilliseconds ?? 0).toDouble().clamp(0.0, duration > 0 ? duration : 1.0);
    final deciding = widget.proposal != null;
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        // swipe down to go back (not while drawing a box)
        onVerticalDragUpdate: boxing ? null : (d) => setState(() => pulled = (pulled + d.delta.dy).clamp(0, 400)),
        onVerticalDragEnd: boxing
            ? null
            : (_) {
                if (pulled > 120) {
                  Navigator.pop(context);
                } else {
                  setState(() => pulled = 0);
                }
              },
        child: Transform.translate(
          offset: Offset(0, pulled),
          child: Opacity(
            opacity: (1 - pulled / 600).clamp(.4, 1),
            child: SafeArea(
              child: Stack(
                children: [
                  // the picture, whole, in the middle
                  Positioned.fill(
                    child: Center(
                      child: error != null
                          ? Padding(
                              padding: const EdgeInsets.all(Space.xl),
                              child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
                            )
                          : c == null || !c.value.isInitialized
                          ? CircularProgressIndicator(color: studio.accent)
                          : AspectRatio(
                              aspectRatio: c.value.aspectRatio,
                              child: LayoutBuilder(
                                builder: (context, size) {
                                  Offset normal(Offset p) => Offset(
                                    (p.dx / size.maxWidth).clamp(0, 1),
                                    (p.dy / size.maxHeight).clamp(0, 1),
                                  );
                                  return GestureDetector(
                                    key: const ValueKey('film-picture'),
                                    onTap: boxing ? null : toggle,
                                    onPanStart: boxing ? (d) => setState(() => from = to = normal(d.localPosition)) : null,
                                    onPanUpdate: boxing ? (d) => setState(() => to = normal(d.localPosition)) : null,
                                    onPanEnd: boxing
                                        ? (_) {
                                            if (from == null || to == null) return;
                                            final r = Rect.fromPoints(from!, to!);
                                            if (r.width > .01 && r.height > .01) {
                                              choose('box', box: {'x': r.left, 'y': r.top, 'w': r.width, 'h': r.height});
                                            }
                                          }
                                        : null,
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        VideoPlayer(c),
                                        if (!playing && !boxing)
                                          Center(
                                            child: IgnorePointer(
                                              child: Container(
                                                width: 64,
                                                height: 64,
                                                decoration: BoxDecoration(
                                                  color: Colors.black.withValues(alpha: .4),
                                                  shape: BoxShape.circle,
                                                ),
                                                child: const Icon(Icons.play_arrow_rounded, size: 38, color: Colors.white),
                                              ),
                                            ),
                                          ),
                                        if (boxing && from != null && to != null)
                                          Positioned.fromRect(
                                            rect: Rect.fromPoints(
                                              Offset(from!.dx * size.maxWidth, from!.dy * size.maxHeight),
                                              Offset(to!.dx * size.maxWidth, to!.dy * size.maxHeight),
                                            ),
                                            child: DecoratedBox(
                                              decoration: BoxDecoration(
                                                border: Border.all(color: studio.info, width: 2),
                                                color: studio.info.withValues(alpha: .15),
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  );
                                },
                              ),
                            ),
                    ),
                  ),
                  // back to the conversation
                  Positioned(
                    left: Space.sm,
                    top: Space.xs,
                    child: IconButton(
                      key: const ValueKey('film-close'),
                      tooltip: 'Back to the conversation',
                      onPressed: () => Navigator.pop(context),
                      style: IconButton.styleFrom(backgroundColor: Colors.black.withValues(alpha: .4)),
                      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: Colors.white, size: 28),
                    ),
                  ),
                  // a new cut: which one plays
                  if (deciding)
                    Positioned(
                      top: Space.sm,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: SegmentedButton<bool>(
                          key: const ValueKey('film-before-after'),
                          showSelectedIcon: false,
                          segments: const [
                            ButtonSegment(value: false, label: Text('Before')),
                            ButtonSegment(value: true, label: Text('After')),
                          ],
                          selected: {after},
                          onSelectionChanged: (s) {
                            setState(() => after = s.first);
                            _load(position, play: playing);
                          },
                        ),
                      ),
                    ),
                  if (boxing)
                    Positioned(
                      top: deciding ? 64 : Space.md,
                      left: 0,
                      right: 0,
                      child: Center(child: StatusPill('Drag on the picture to draw a box', color: studio.info, onMedia: true)),
                    ),
                  // what can be done with it, floating down the right (as reels)
                  Positioned(
                    right: Space.sm,
                    bottom: deciding ? 150 : 96,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        rail(Icons.add_comment_outlined, 'Note', () => choose('note'), key: const ValueKey('film-note')),
                        rail(
                          Icons.crop_free_rounded,
                          boxing ? 'Cancel' : 'Box',
                          () => setState(() {
                            boxing = !boxing;
                            from = to = null;
                            if (boxing) controller?.pause();
                          }),
                          on: boxing,
                          key: const ValueKey('film-box'),
                        ),
                        rail(Icons.straighten_rounded, 'Range', () => choose('range')),
                        rail(Icons.view_timeline_outlined, 'Timeline', () => choose('timeline')),
                        rail(Icons.ios_share_rounded, 'Share', () => choose('export')),
                        if (widget.menu.isNotEmpty) rail(Icons.more_horiz_rounded, 'More', more),
                      ],
                    ),
                  ),
                  // the scrubber, and on a new cut, Keep and Send back: at the bottom, where the thumb is
                  Positioned(
                    left: Space.md,
                    right: Space.md,
                    bottom: Space.sm,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (deciding) ...[
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  key: const ValueKey('film-send-back'),
                                  onPressed: () => choose('sendBack'),
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.white,
                                    side: const BorderSide(color: Colors.white54),
                                    minimumSize: const Size(0, 48),
                                  ),
                                  child: const Text('Send back'),
                                ),
                              ),
                              const SizedBox(width: Space.md),
                              Expanded(
                                child: FilledButton.icon(
                                  key: const ValueKey('film-keep'),
                                  onPressed: () => choose('keep'),
                                  style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                                  icon: const Icon(Icons.check),
                                  label: const Text('Keep'),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Space.sm),
                        ],
                        Row(
                          children: [
                            IconButton(
                              tooltip: playing ? 'Pause' : 'Play',
                              onPressed: toggle,
                              icon: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, color: Colors.white),
                            ),
                            Expanded(
                              child: Slider(
                                value: at,
                                max: duration > 0 ? duration : 1,
                                onChanged: duration <= 0 ? null : (v) => c?.seekTo(Duration(milliseconds: v.round())),
                              ),
                            ),
                            Text(
                              '${timestamp(at / 1000)} / ${timestamp(duration / 1000)}',
                              style: text.labelMedium?.copyWith(color: Colors.white70, fontFeatures: tabular),
                            ),
                            const SizedBox(width: Space.sm),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../bridge/client.dart';
import 'common.dart';
import 'design.dart';
import 'range_notes.dart';

class RemotePlayer extends StatefulWidget {
  final Future<Uri> Function() uri;
  final ValueChanged<double>? onPosition;
  final ValueChanged<Json>? onBox;
  final bool boxMode;
  final double initialPosition;
  final List<RangeDraft> ranges;
  final void Function(double start, double end)? onRange;
  const RemotePlayer({
    super.key,
    required this.uri,
    this.onPosition,
    this.onBox,
    this.boxMode = false,
    this.initialPosition = 0,
    this.ranges = const [],
    this.onRange,
    this.maxHeight = .48,
  });

  /// The most of the screen's height the picture takes (less where the conversation shares the screen).
  final double maxHeight;
  @override
  State<RemotePlayer> createState() => _RemotePlayerState();
}

class _RemotePlayerState extends State<RemotePlayer> {
  VideoPlayerController? controller;
  String? error;
  Offset? from, to;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    VideoPlayerController? next;
    try {
      final uri = await widget.uri();
      if (!mounted) return;
      next = VideoPlayerController.networkUrl(uri);
      await next.initialize();
      if (!mounted) {
        await next.dispose();
        return;
      }
      await next.seekTo(
        Duration(milliseconds: (widget.initialPosition * 1000).round()),
      );
      controller = next..addListener(_tick);
      setState(() {});
    } catch (e) {
      await next?.dispose();
      if (mounted) {
        setState(() => error = 'Couldn’t play this here. ${plain(e)}');
      }
    }
  }

  void _tick() {
    if (mounted) {
      widget.onPosition?.call(controller!.value.position.inMilliseconds / 1000);
      setState(() {});
    }
  }

  @override
  void didUpdateWidget(RemotePlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.boxMode && !oldWidget.boxMode) controller?.pause();
  }

  @override
  void dispose() {
    controller?.removeListener(_tick);
    controller?.dispose();
    super.dispose();
  }

  void toggle() {
    final c = controller;
    if (c == null) return;
    c.value.isPlaying ? c.pause() : c.play();
  }

  /// The film filling the screen, sideways if it's wide; the same playback, so it carries on where it was.
  Future<void> fullScreen() async {
    final c = controller;
    if (c == null) return;
    await Navigator.of(context, rootNavigator: true).push(
      PageRouteBuilder<void>(
        opaque: true,
        pageBuilder: (context, _, _) => _FullScreen(controller: c),
        transitionsBuilder: (_, animation, _, child) => FadeTransition(opacity: animation, child: child),
      ),
    );
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    final limit = MediaQuery.sizeOf(context).height * widget.maxHeight;
    if (error != null) {
      return Container(
        constraints: BoxConstraints(maxHeight: limit.clamp(120, double.infinity)),
        padding: const EdgeInsets.all(Space.lg),
        decoration: ShapeDecoration(color: studio.surface2, shape: smooth(16)),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.videocam_off_rounded, color: studio.text3),
              const SizedBox(height: Space.sm),
              Text(error!, textAlign: TextAlign.center, style: text.bodySmall),
              const SizedBox(height: Space.sm),
              TextButton.icon(
                onPressed: () {
                  setState(() => error = null);
                  _load();
                },
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Retry preview'),
              ),
            ],
          ),
        ),
      );
    }
    if (c == null) {
      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: limit),
        child: AspectRatio(
          aspectRatio: 16 / 9,
          child: DecoratedBox(
            decoration: ShapeDecoration(color: studio.film, shape: smooth(16)),
            child: const Center(
              child: SizedBox.square(dimension: 26, child: CircularProgressIndicator(strokeWidth: 2.5)),
            ),
          ),
        ),
      );
    }
    final duration = c.value.duration.inMilliseconds.toDouble();
    final position = c.value.position.inMilliseconds.toDouble().clamp(
      0.0,
      duration,
    );
    final playing = c.value.isPlaying;
    final muted = c.value.volume == 0;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: limit),
            child: AspectRatio(
              aspectRatio: c.value.aspectRatio > 0
                  ? c.value.aspectRatio
                  : 16 / 9,
              child: ClipRSuperellipse(
                borderRadius: BorderRadius.circular(16),
                child: LayoutBuilder(
                  builder: (context, size) {
                    Offset normalized(Offset point) => Offset(
                      (point.dx / size.maxWidth).clamp(0, 1),
                      (point.dy / size.maxHeight).clamp(0, 1),
                    );
                    return GestureDetector(
                      // a tap on the picture plays and pauses (not while drawing a box on it)
                      onTap: widget.boxMode ? null : toggle,
                      onPanStart: !widget.boxMode
                          ? null
                          : (event) => setState(() {
                              from = normalized(event.localPosition);
                              to = from;
                            }),
                      onPanUpdate: !widget.boxMode
                          ? null
                          : (event) => setState(
                              () => to = normalized(event.localPosition),
                            ),
                      onPanEnd: !widget.boxMode
                          ? null
                          : (_) {
                              if (from == null || to == null) return;
                              final rect = Rect.fromPoints(from!, to!);
                              if (rect.width > .01 && rect.height > .01) {
                                widget.onBox?.call({
                                  'x': rect.left,
                                  'y': rect.top,
                                  'w': rect.width,
                                  'h': rect.height,
                                });
                              }
                            },
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          ColoredBox(color: studio.film, child: VideoPlayer(c)),
                          // paused: one big way to play, over the picture
                          if (!playing && !widget.boxMode)
                            Center(
                              child: IgnorePointer(
                                child: Container(
                                  width: 56,
                                  height: 56,
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: .45),
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white.withValues(alpha: .25)),
                                  ),
                                  child: const Icon(Icons.play_arrow_rounded, size: 34, color: Colors.white),
                                ),
                              ),
                            ),
                          if (!playing && !widget.boxMode)
                            Positioned(
                              right: 4,
                              bottom: 4,
                              child: IconButton(
                                tooltip: 'Full screen',
                                onPressed: fullScreen,
                                color: Colors.white,
                                icon: const Icon(Icons.fullscreen_rounded),
                              ),
                            ),
                          if (widget.boxMode)
                            Positioned(
                              top: Space.sm,
                              left: Space.sm,
                              child: StatusPill('Drag to draw a box', color: studio.info, onMedia: true),
                            ),
                          if (widget.boxMode && from != null && to != null)
                            Positioned.fromRect(
                              rect: Rect.fromPoints(
                                Offset(
                                  from!.dx * size.maxWidth,
                                  from!.dy * size.maxHeight,
                                ),
                                Offset(
                                  to!.dx * size.maxWidth,
                                  to!.dy * size.maxHeight,
                                ),
                              ),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  border: Border.all(
                                    color: studio.info,
                                    width: 2,
                                  ),
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
        ),
        if (c.value.hasError)
          Padding(
            padding: const EdgeInsets.only(top: Space.sm),
            child: Text(
              c.value.errorDescription ?? 'Preview playback failed',
              style: text.bodySmall?.copyWith(color: studio.danger),
            ),
          ),
        // the transport: play, the scrubber, where it is of how long, sound (full screen is on the picture, paused)
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Row(
            children: [
              IconButton(
                tooltip: playing ? 'Pause' : 'Play',
                onPressed: toggle,
                icon: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 26),
              ),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
                  ),
                  child: Slider(
                    value: position,
                    max: duration > 0 ? duration : 1,
                    onChanged: duration <= 0
                        ? null
                        : (v) => c.seekTo(Duration(milliseconds: v.round())),
                    semanticFormatterCallback: (v) => timestamp(v / 1000),
                  ),
                ),
              ),
              Text(
                '${timestamp(position / 1000)} / ${timestamp(duration / 1000)}',
                style: text.labelMedium?.copyWith(color: studio.text2, fontFeatures: tabular),
              ),
              IconButton(
                tooltip: muted ? 'Unmute' : 'Mute',
                onPressed: () => c.setVolume(muted ? 1 : 0),
                icon: Icon(muted ? Icons.volume_off_rounded : Icons.volume_up_rounded, size: 20, color: studio.text2),
              ),
            ],
          ),
        ),
        if (widget.onRange != null)
          RangeTimeline(
            duration: duration / 1000,
            position: position / 1000,
            notes: widget.ranges,
            onSeek: (v) => c.seekTo(Duration(milliseconds: (v * 1000).round())),
            onRange: (start, end) {
              c.pause();
              widget.onRange!(start, end);
            },
          ),
      ],
    );
  }
}

class _FullScreen extends StatefulWidget {
  final VideoPlayerController controller;
  const _FullScreen({required this.controller});
  @override
  State<_FullScreen> createState() => _FullScreenState();
}

class _FullScreenState extends State<_FullScreen> {
  VideoPlayerController get c => widget.controller;
  void _tick() {
    if (mounted) setState(() {});
  }

  @override
  void initState() {
    super.initState();
    c.addListener(_tick);
  }

  @override
  void dispose() {
    c.removeListener(_tick);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final duration = c.value.duration.inMilliseconds.toDouble();
    final position = c.value.position.inMilliseconds.toDouble().clamp(0.0, duration);
    final wide = c.value.aspectRatio > 1 && MediaQuery.sizeOf(context).width < MediaQuery.sizeOf(context).height;
    final picture = AspectRatio(
      aspectRatio: c.value.aspectRatio > 0 ? c.value.aspectRatio : 16 / 9,
      child: VideoPlayer(c),
    );
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            GestureDetector(
              onTap: () => c.value.isPlaying ? c.pause() : c.play(),
              child: Center(
                // a wide film on an upright phone turns to fill it
                child: wide ? RotatedBox(quarterTurns: 1, child: picture) : picture,
              ),
            ),
            Positioned(
              top: Space.sm,
              left: Space.sm,
              child: IconButton(
                tooltip: 'Close',
                onPressed: () => Navigator.pop(context),
                style: IconButton.styleFrom(backgroundColor: Colors.black54, foregroundColor: Colors.white),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
            Positioned(
              left: Space.lg,
              right: Space.lg,
              bottom: Space.md,
              child: Theme(
                data: Theme.of(context).copyWith(iconTheme: const IconThemeData(color: Colors.white)),
                child: Row(
                  children: [
                    IconButton(
                      tooltip: c.value.isPlaying ? 'Pause' : 'Play',
                      color: Colors.white,
                      onPressed: () => c.value.isPlaying ? c.pause() : c.play(),
                      icon: Icon(c.value.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded),
                    ),
                    Expanded(
                      child: Slider(
                        value: position,
                        max: duration > 0 ? duration : 1,
                        onChanged: duration <= 0 ? null : (v) => c.seekTo(Duration(milliseconds: v.round())),
                      ),
                    ),
                    Text(
                      '${timestamp(position / 1000)} / ${timestamp(duration / 1000)}',
                      style: const TextStyle(color: Colors.white, fontFeatures: tabular),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

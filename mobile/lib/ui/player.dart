import 'dart:async';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../bridge/client.dart';
import 'common.dart';
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
  });
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

  @override
  Widget build(BuildContext context) {
    final c = controller;
    if (error != null) {
      return Column(
        children: [
          Text(error!),
          TextButton(
            onPressed: () {
              setState(() => error = null);
              _load();
            },
            child: const Text('Retry preview'),
          ),
        ],
      );
    }
    if (c == null) {
      return const AspectRatio(
        aspectRatio: 16 / 9,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final duration = c.value.duration.inMilliseconds.toDouble();
    final position = c.value.position.inMilliseconds.toDouble().clamp(
      0.0,
      duration,
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * .48,
            ),
            child: AspectRatio(
              aspectRatio: c.value.aspectRatio > 0
                  ? c.value.aspectRatio
                  : 16 / 9,
              child: LayoutBuilder(
                builder: (context, size) {
                  Offset normalized(Offset point) => Offset(
                    (point.dx / size.maxWidth).clamp(0, 1),
                    (point.dy / size.maxHeight).clamp(0, 1),
                  );
                  return GestureDetector(
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
                        ColoredBox(color: Colors.black, child: VideoPlayer(c)),
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
                                  color: Colors.lightBlueAccent,
                                  width: 2,
                                ),
                                color: Colors.blue.withValues(alpha: .15),
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
        if (c.value.hasError)
          Text(c.value.errorDescription ?? 'Preview playback failed'),
        Slider(
          value: position,
          max: duration > 0 ? duration : 1,
          onChanged: duration <= 0
              ? null
              : (v) => c.seekTo(Duration(milliseconds: v.round())),
          semanticFormatterCallback: (v) => timestamp(v / 1000),
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
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            IconButton(
              tooltip: c.value.isPlaying ? 'Pause' : 'Play',
              onPressed: () => c.value.isPlaying ? c.pause() : c.play(),
              icon: Icon(c.value.isPlaying ? Icons.pause : Icons.play_arrow),
            ),
            Text(
              '${timestamp(position / 1000)} / ${timestamp(duration / 1000)}',
            ),
            IconButton(
              tooltip: c.value.volume == 0 ? 'Unmute' : 'Mute',
              onPressed: () => c.setVolume(c.value.volume == 0 ? 1 : 0),
              icon: Icon(
                c.value.volume == 0 ? Icons.volume_off : Icons.volume_up,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

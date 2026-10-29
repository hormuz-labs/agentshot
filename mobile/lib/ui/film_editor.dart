import 'dart:async';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../bridge/client.dart';
import 'common.dart';
import 'design.dart';
import 'dictation.dart';

/// On a phone, a project is its film: it fills the screen, with the cut's shots in a strip under it. Notes are pins:
/// on the picture where a box was drawn, and on the strip at their moment, each showing where it stands (waiting, being
/// worked on, done, with the agent's reply). Note, Box and Range open a small bubble right where it's pointed; what the
/// agent is doing shows at the top, and its whole conversation is one swipe up ([onActivity]). A new cut waiting plays
/// here, with Before / After and Send back / Keep.
class FilmEditor extends StatefulWidget {
  /// The project's name, and where its film and a new cut waiting play from.
  final String title;
  final Future<Uri> Function() film;
  final Future<Uri> Function()? proposal;

  /// The notes given on the film (`anchor` with `t0`, maybe `t1` and `box`; `text`; `status`; `reply`).
  final List<Json> notes;

  /// The cut's shots, as (seconds long) in order, for the strip; none: a plain strip.
  final List<double> shots;

  /// What the agent is doing now, in words; null when it's not working.
  final String? working;
  final bool connected;

  /// A note: its words, and where it points (`t0`, `t1`, `box`), or none for the whole film.
  final Future<void> Function(String text, Json? anchor) onNote;
  final VoidCallback onActivity, onKeep, onSendBack, onBack;

  /// The project's ⋯ menu (key, name, icon); a key chosen comes back through [onAction].
  final List<(String, String, IconData)> menu;
  final ValueChanged<String> onAction;

  /// Where the film is, for whoever asks next (a range note's start).
  final ValueChanged<double>? onPosition;
  const FilmEditor({
    super.key,
    required this.title,
    required this.film,
    this.proposal,
    this.notes = const [],
    this.shots = const [],
    this.working,
    this.connected = true,
    required this.onNote,
    required this.onActivity,
    required this.onKeep,
    required this.onSendBack,
    required this.onBack,
    this.menu = const [],
    required this.onAction,
    this.onPosition,
  });

  @override
  State<FilmEditor> createState() => _FilmEditorState();
}

/// What's being pointed at while its note is written: a moment, a box at a moment, a range, or the whole film.
enum Pointing { none, moment, box, range, film }

class _FilmEditorState extends State<FilmEditor> {
  VideoPlayerController? controller;
  String? error;
  late bool after = widget.proposal != null;

  Pointing pointing = Pointing.none;
  Offset? from, to;

  /// A range being marked on the strip: where it starts and ends (seconds).
  double? rangeFrom, rangeTo;

  /// Where the note being written points, once the pointing is done (the bubble is open).
  Json? anchor;
  bool writing = false;
  final words = TextEditingController();
  final focus = FocusNode();

  /// Notes sent but not yet back in the project: pinned already.
  final sent = <Json>[];

  /// A pin tapped: its note shown, with the agent's reply.
  Json? open;

  @override
  void initState() {
    super.initState();
    _load(0);
  }

  @override
  void didUpdateWidget(FilmEditor old) {
    super.didUpdateWidget(old);
    // a new cut came, or went (kept, sent back): play what's there now
    if ((old.proposal == null) != (widget.proposal == null)) {
      after = widget.proposal != null;
      _load(position);
    }
    // a note back from the computer is the one pinned meanwhile
    sent.removeWhere((s) => widget.notes.any((n) => n['text'] == s['text']));
  }

  Future<void> _load(double at, {bool play = false}) async {
    final old = controller;
    VideoPlayerController? next;
    try {
      final uri = await (after && widget.proposal != null
          ? widget.proposal!
          : widget.film)();
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
      if (mounted) {
        setState(() => error = 'Couldn’t play this here. ${plain(e)}');
      }
    }
  }

  void _tick() {
    if (!mounted) return;
    widget.onPosition?.call(position);
    setState(() {});
  }

  @override
  void dispose() {
    controller?.removeListener(_tick);
    controller?.dispose();
    words.dispose();
    focus.dispose();
    super.dispose();
  }

  double get position =>
      (controller?.value.position.inMilliseconds ?? 0) / 1000;
  double get length => (controller?.value.duration.inMilliseconds ?? 0) / 1000;

  void toggle() {
    final c = controller;
    if (c == null) return;
    c.value.isPlaying ? c.pause() : c.play();
  }

  void seek(double seconds) => controller?.seekTo(
    Duration(milliseconds: (seconds.clamp(0, length) * 1000).round()),
  );

  /// Starts pointing: the film pauses, and for a moment (or the whole film) the bubble opens at once.
  void point(Pointing how) {
    controller?.pause();
    setState(() {
      open = null;
      from = to = null;
      rangeFrom = rangeTo = null;
      if (pointing == how) {
        pointing = Pointing.none;
        writing = false;
        return;
      }
      pointing = how;
      writing = how == Pointing.moment || how == Pointing.film;
      anchor = switch (how) {
        Pointing.moment => {'t0': position},
        _ => null,
      };
    });
    if (writing) focus.requestFocus();
  }

  void pointed(Json at) {
    setState(() {
      anchor = at;
      writing = true;
    });
    focus.requestFocus();
  }

  void cancel() {
    focus.unfocus();
    setState(() {
      pointing = Pointing.none;
      writing = false;
      anchor = null;
      from = to = null;
      rangeFrom = rangeTo = null;
    });
  }

  Future<void> send() async {
    final text = words.text.trim();
    if (text.isEmpty) return;
    final at = anchor;
    final note = {'text': text, 'anchor': ?at, 'status': 'sending'};
    words.clear();
    setState(() => sent.add(note));
    cancel();
    try {
      await widget.onNote(text, at);
    } catch (e) {
      if (!mounted) return;
      // it didn't go: back in the bubble as it was
      setState(() {
        sent.remove(note);
        words.text = text;
        anchor = at;
        writing = true;
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(plain(e))));
    }
  }

  /// Every note to pin: the project's, then those on their way.
  List<Json> get pins => [...widget.notes, ...sent];

  /// Where a note stands, in a word and a colour: on its way, being worked on, done, or waiting its turn.
  (String, Color, IconData) standing(Json note, Studio studio) =>
      switch (note['status']) {
        'resolved' => ('Done', studio.success, Icons.check_rounded),
        'sending' => ('Sending', studio.text3, Icons.arrow_upward_rounded),
        _ when widget.working != null => (
          'Working',
          studio.accent,
          Icons.more_horiz_rounded,
        ),
        _ => ('Waiting', studio.accent, Icons.schedule_rounded),
      };

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final c = controller;
    final deciding = widget.proposal != null && widget.working == null;
    final keyboard = MediaQuery.viewInsetsOf(context).bottom > 0;
    return ColoredBox(
      color: Colors.black,
      child: SafeArea(
        child: Column(
          children: [
            topBar(studio),
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: picture(c, studio)),
                  if (open case final note?)
                    Positioned(
                      left: Space.md,
                      right: Space.md,
                      bottom: Space.md,
                      child: noteCard(note, studio),
                    ),
                  if (writing)
                    Positioned(
                      left: Space.md,
                      right: Space.md,
                      bottom: Space.sm,
                      child: bubble(studio),
                    ),
                ],
              ),
            ),
            if (!keyboard) ...[
              strip(studio),
              if (deciding) decide(studio) else tools(studio),
            ],
          ],
        ),
      ),
    );
  }

  Widget topBar(Studio studio) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.xs, Space.xs, Space.xs, 0),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
          ),
          Expanded(
            child: Text(
              widget.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: text.titleSmall?.copyWith(color: Colors.white),
            ),
          ),
          // what the agent is doing, at a glance; a tap opens the whole of it
          GestureDetector(
            key: const ValueKey('editor-activity'),
            onTap: widget.onActivity,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: widget.working != null
                    ? studio.accent
                    : Colors.white.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.working != null) ...[
                    SizedBox.square(
                      dimension: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: studio.onAccent,
                      ),
                    ),
                    const SizedBox(width: 6),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 130),
                      child: Text(
                        widget.working!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.labelMedium?.copyWith(
                          color: studio.onAccent,
                        ),
                      ),
                    ),
                  ] else
                    Icon(
                      widget.connected
                          ? Icons.forum_outlined
                          : Icons.cloud_off_rounded,
                      size: 18,
                      color: Colors.white,
                    ),
                ],
              ),
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Project actions',
            onSelected: widget.onAction,
            icon: const Icon(Icons.more_horiz_rounded, color: Colors.white),
            itemBuilder: (_) => [
              for (final (key, name, icon) in widget.menu)
                PopupMenuItem(
                  value: key,
                  child: Row(
                    children: [
                      Icon(icon, size: 20),
                      const SizedBox(width: Space.md),
                      Text(name),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// The film, whole, with the boxes noted near this moment pinned on it; drawing a box when Box is on.
  Widget picture(VideoPlayerController? c, Studio studio) {
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(Space.xl),
          child: Text(
            error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70),
          ),
        ),
      );
    }
    if (c == null || !c.value.isInitialized) {
      return Center(child: CircularProgressIndicator(color: studio.accent));
    }
    final playing = c.value.isPlaying;
    return Center(
      child: AspectRatio(
        aspectRatio: c.value.aspectRatio,
        child: LayoutBuilder(
          builder: (context, size) {
            Offset normal(Offset p) => Offset(
              (p.dx / size.maxWidth).clamp(0, 1),
              (p.dy / size.maxHeight).clamp(0, 1),
            );
            final boxing = pointing == Pointing.box && !writing;
            // a box pinned while the film is near its moment (a beat before, a couple of seconds after)
            final near = [
              for (final (i, n) in pins.indexed)
                if (object(n['anchor'] ?? {})['box'] case final Map box)
                  if ((position - ((object(n['anchor'])['t0'] as num?) ?? 0))
                          .abs() <
                      2)
                    (i, n, object(box)),
            ];
            return GestureDetector(
              key: const ValueKey('editor-picture'),
              onTap: boxing
                  ? null
                  : () => open == null ? toggle() : setState(() => open = null),
              onPanStart: boxing
                  ? (d) => setState(() => from = to = normal(d.localPosition))
                  : null,
              onPanUpdate: boxing
                  ? (d) => setState(() => to = normal(d.localPosition))
                  : null,
              onPanEnd: boxing
                  ? (_) {
                      if (from == null || to == null) return;
                      final r = Rect.fromPoints(from!, to!);
                      if (r.width > .01 && r.height > .01) {
                        pointed({
                          't0': position,
                          'box': {
                            'x': r.left,
                            'y': r.top,
                            'w': r.width,
                            'h': r.height,
                          },
                        });
                      }
                    }
                  : null,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  VideoPlayer(c),
                  if (!playing && pointing == Pointing.none && open == null)
                    const Center(
                      child: IgnorePointer(
                        child: CircleAvatar(
                          radius: 30,
                          backgroundColor: Colors.black38,
                          child: Icon(
                            Icons.play_arrow_rounded,
                            size: 36,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                  for (final (i, n, box) in near)
                    Positioned(
                      left: (box['x'] as num) * size.maxWidth,
                      top: (box['y'] as num) * size.maxHeight,
                      width: (box['w'] as num) * size.maxWidth,
                      height: (box['h'] as num) * size.maxHeight,
                      child: GestureDetector(
                        onTap: () => setState(() => open = n),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: standing(n, studio).$2,
                              width: 2,
                            ),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Align(
                            alignment: Alignment.topLeft,
                            child: pin(i, n, studio),
                          ),
                        ),
                      ),
                    ),
                  if (from != null && to != null && pointing == Pointing.box)
                    Positioned.fromRect(
                      rect: Rect.fromPoints(
                        Offset(
                          from!.dx * size.maxWidth,
                          from!.dy * size.maxHeight,
                        ),
                        Offset(to!.dx * size.maxWidth, to!.dy * size.maxHeight),
                      ),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          border: Border.all(color: studio.info, width: 2),
                          color: studio.info.withValues(alpha: .15),
                        ),
                      ),
                    ),
                  if (boxing && from == null)
                    Align(
                      alignment: Alignment.topCenter,
                      child: Padding(
                        padding: const EdgeInsets.only(top: Space.md),
                        child: StatusPill(
                          'Draw a box on the picture',
                          color: studio.info,
                          onMedia: true,
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  /// A note's number, in the colour of where it stands.
  Widget pin(int i, Json note, Studio studio) {
    final (word, color, icon) = standing(note, studio);
    return Semantics(
      label: 'Note ${i + 1}, $word',
      child: Container(
        width: 22,
        height: 22,
        margin: const EdgeInsets.all(2),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: note['status'] == 'resolved'
            ? Icon(icon, size: 14, color: Colors.black)
            : Text(
                '${i + 1}',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: Colors.black,
                ),
              ),
      ),
    );
  }

  /// A pin opened: what was asked, where it stands, and the agent's answer.
  Widget noteCard(Json note, Studio studio) {
    final text = Theme.of(context).textTheme;
    final (word, color, _) = standing(note, studio);
    final at = object(note['anchor'] ?? {});
    return Material(
      key: const ValueKey('editor-note'),
      color: studio.surface1,
      shape: smooth(14),
      child: Padding(
        padding: const EdgeInsets.all(Space.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Icon(Icons.circle, size: 8, color: color),
                const SizedBox(width: 6),
                Text(
                  [
                    if (at['t0'] case final num t) timestamp(t),
                    word,
                  ].join(' · '),
                  style: text.labelSmall?.copyWith(color: studio.text3),
                ),
                const Spacer(),
                InkWell(
                  onTap: () => setState(() => open = null),
                  child: Icon(
                    Icons.close_rounded,
                    size: 18,
                    color: studio.text3,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text('${note['text'] ?? ''}', style: text.bodyMedium),
            if ('${note['reply'] ?? ''}'.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                '${note['reply']}',
                style: text.bodySmall?.copyWith(color: studio.text2),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// The small box a note is written in, right over the film: what it points at, the words, the mic, send.
  Widget bubble(Studio studio) {
    final text = Theme.of(context).textTheme;
    final at = anchor;
    final where = switch (pointing) {
      Pointing.film => 'The whole film',
      Pointing.box when at != null =>
        '${timestamp(at['t0'] as num)} · on this box',
      Pointing.range when at != null =>
        '${timestamp(at['t0'] as num)}–${timestamp(at['t1'] as num)}',
      _ when at != null => 'At ${timestamp(at['t0'] as num)}',
      _ => '',
    };
    return Material(
      key: const ValueKey('editor-bubble'),
      color: studio.surface1,
      shape: smooth(
        16,
        side: BorderSide(color: studio.accent.withValues(alpha: .6)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.md,
          Space.sm,
          Space.xs,
          Space.xs,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Text(
                  where,
                  style: text.labelSmall?.copyWith(color: studio.text3),
                ),
                const Spacer(),
                InkWell(
                  onTap: cancel,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(
                      Icons.close_rounded,
                      size: 18,
                      color: studio.text3,
                    ),
                  ),
                ),
              ],
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('editor-words'),
                    controller: words,
                    focusNode: focus,
                    minLines: 1,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      hintText: 'What should change?',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      isDense: true,
                    ),
                    onSubmitted: (_) => send(),
                  ),
                ),
                VoiceButton(
                  onWords: (said) {
                    words.text = [
                      words.text.trim(),
                      said,
                    ].where((s) => s.isNotEmpty).join(' ');
                    setState(() {});
                  },
                ),
                IconButton(
                  key: const ValueKey('editor-send'),
                  tooltip: 'Send',
                  onPressed: send,
                  icon: Icon(Icons.arrow_upward_rounded, color: studio.accent),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// The cut's shots in a strip, the notes as pins at their moments, the playhead; drag to move through the film, or,
  /// marking a range, to mark it.
  Widget strip(Studio studio) {
    final total = length;
    final shots = widget.shots.where((s) => s > 0).toList();
    final ranging = pointing == Pointing.range && !writing;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.md,
        Space.sm,
        Space.md,
        Space.xs,
      ),
      child: Column(
        children: [
          LayoutBuilder(
            builder: (context, size) {
              double at(double dx) =>
                  total <= 0 ? 0 : (dx / size.maxWidth).clamp(0, 1) * total;
              double x(num seconds) => total <= 0
                  ? 0
                  : (seconds / total).clamp(0, 1) * size.maxWidth;
              return GestureDetector(
                key: const ValueKey('editor-strip'),
                behavior: HitTestBehavior.opaque,
                onTapDown: ranging ? null : (d) => seek(at(d.localPosition.dx)),
                onHorizontalDragStart: (d) => ranging
                    ? setState(
                        () => rangeFrom = rangeTo = at(d.localPosition.dx),
                      )
                    : seek(at(d.localPosition.dx)),
                onHorizontalDragUpdate: (d) => ranging
                    ? setState(() => rangeTo = at(d.localPosition.dx))
                    : seek(at(d.localPosition.dx)),
                onHorizontalDragEnd: (_) {
                  if (!ranging || rangeFrom == null || rangeTo == null) return;
                  final (a, b) = rangeFrom! < rangeTo!
                      ? (rangeFrom!, rangeTo!)
                      : (rangeTo!, rangeFrom!);
                  if (b - a >= .2) pointed({'t0': a, 't1': b});
                },
                child: SizedBox(
                  height: 44,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      // the shots, side by side by length
                      Positioned.fill(
                        top: 10,
                        child: Row(
                          children: [
                            if (shots.isEmpty)
                              Expanded(child: segment(studio))
                            else
                              for (final s in shots)
                                Expanded(
                                  flex: (s * 100).round().clamp(1, 1 << 20),
                                  child: segment(studio),
                                ),
                          ],
                        ),
                      ),
                      if (rangeFrom != null && rangeTo != null)
                        Positioned(
                          left: x(
                            rangeFrom! < rangeTo! ? rangeFrom! : rangeTo!,
                          ),
                          width: (x(rangeTo!) - x(rangeFrom!)).abs(),
                          top: 10,
                          bottom: 0,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: studio.info.withValues(alpha: .3),
                              border: Border.all(color: studio.info, width: 2),
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                      // the notes at their moments
                      for (final (i, n) in pins.indexed)
                        if (object(n['anchor'] ?? {})['t0'] case final num t0)
                          Positioned(
                            // inside the strip at its ends, where a finger can still reach it
                            left: (x(t0) - 6).clamp(0, size.maxWidth - 12),
                            top: 0,
                            child: GestureDetector(
                              key: ValueKey('editor-pin-$i'),
                              onTap: () {
                                seek(t0.toDouble());
                                setState(() => open = n);
                              },
                              child: Container(
                                width: 12,
                                height: 12,
                                decoration: BoxDecoration(
                                  color: standing(n, studio).$2,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: Colors.black,
                                    width: 1.5,
                                  ),
                                ),
                              ),
                            ),
                          ),
                      // the playhead
                      Positioned(
                        left: x(position) - 1,
                        top: 4,
                        bottom: -4,
                        child: Container(width: 2, color: Colors.white),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              GestureDetector(
                onTap: toggle,
                child: Icon(
                  controller?.value.isPlaying ?? false
                      ? Icons.pause_rounded
                      : Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 22,
                ),
              ),
              const SizedBox(width: Space.sm),
              // the clock shrinks with very large text rather than running past the edge
              Flexible(
                flex: 3,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '${timestamp(position)} / ${timestamp(total)}',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: Colors.white70,
                      fontFeatures: tabular,
                    ),
                  ),
                ),
              ),
              const Spacer(),
              if (ranging)
                Flexible(
                  flex: 4,
                  child: Text(
                    'Drag across the strip',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.labelSmall?.copyWith(color: studio.info),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget segment(Studio studio) => Container(
    margin: const EdgeInsets.symmetric(horizontal: 1),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: .16),
      borderRadius: BorderRadius.circular(4),
    ),
  );

  /// Pointing at the film: a moment, a box, a range; or a note for the whole of it.
  Widget tools(Studio studio) {
    Widget tool(IconData icon, String label, Pointing how, Key key) {
      final on = pointing == how;
      return Expanded(
        child: InkWell(
          key: key,
          onTap: widget.connected ? () => point(how) : null,
          customBorder: smooth(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Space.sm),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 22, color: on ? studio.accent : Colors.white),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    label,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: on ? studio.accent : Colors.white70,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.sm, 0, Space.sm, Space.xs),
      child: Row(
        children: [
          tool(
            Icons.add_comment_outlined,
            'Note',
            Pointing.moment,
            const ValueKey('editor-note-tool'),
          ),
          tool(
            Icons.crop_free_rounded,
            'Box',
            Pointing.box,
            const ValueKey('editor-box-tool'),
          ),
          tool(
            Icons.straighten_rounded,
            'Range',
            Pointing.range,
            const ValueKey('editor-range-tool'),
          ),
          tool(
            Icons.chat_bubble_outline_rounded,
            'Ask',
            Pointing.film,
            const ValueKey('editor-ask-tool'),
          ),
        ],
      ),
    );
  }

  /// A new cut waiting: which plays, and keep it or send it back.
  Widget decide(Studio studio) => Padding(
    padding: const EdgeInsets.fromLTRB(Space.md, 0, Space.md, Space.sm),
    child: Row(
      children: [
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: SegmentedButton<bool>(
              key: const ValueKey('editor-before-after'),
              showSelectedIcon: false,
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              segments: const [
                ButtonSegment(value: false, label: Text('Before')),
                ButtonSegment(value: true, label: Text('After')),
              ],
              selected: {after},
              onSelectionChanged: (s) {
                setState(() => after = s.first);
                _load(position, play: controller?.value.isPlaying ?? false);
              },
            ),
          ),
        ),
        const SizedBox(width: Space.sm),
        Expanded(
          child: OutlinedButton(
            key: const ValueKey('editor-send-back'),
            onPressed: widget.onSendBack,
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white,
              side: const BorderSide(color: Colors.white38),
            ),
            child: const FittedBox(
              fit: BoxFit.scaleDown,
              child: Text('Send back'),
            ),
          ),
        ),
        const SizedBox(width: Space.sm),
        Expanded(
          child: FilledButton(
            key: const ValueKey('editor-keep'),
            onPressed: widget.onKeep,
            child: const FittedBox(fit: BoxFit.scaleDown, child: Text('Keep')),
          ),
        ),
      ],
    ),
  );
}

/// The mic in the note bubble: a tap listens with the phone's own speech recognition, a second tap ends and hands
/// over what was said.
class VoiceButton extends StatefulWidget {
  final ValueChanged<String> onWords;
  const VoiceButton({super.key, required this.onWords});
  @override
  State<VoiceButton> createState() => _VoiceButtonState();
}

class _VoiceButtonState extends State<VoiceButton> {
  Dictation? listening;
  String heard = '';

  @override
  void dispose() {
    listening?.cancel();
    listening?.dispose();
    super.dispose();
  }

  Future<void> tap() async {
    final d = listening;
    if (d != null) {
      setState(() => listening = null);
      final said = (await d.stop()).trim();
      d.dispose();
      if (said.isNotEmpty) widget.onWords(said);
      return;
    }
    final next = Dictation.create();
    if (!await next.available() || !await next.start((w) => heard = w)) {
      next.dispose();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Allow the microphone for AgentShot to talk your notes.',
            ),
          ),
        );
      }
      return;
    }
    if (mounted) setState(() => listening = next);
  }

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    return IconButton(
      key: const ValueKey('editor-mic'),
      tooltip: listening == null ? 'Talk' : 'Done talking',
      onPressed: tap,
      icon: Icon(
        listening == null ? Icons.mic_none_rounded : Icons.stop_circle_outlined,
        color: listening == null ? studio.text2 : studio.accent,
      ),
    );
  }
}

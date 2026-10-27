import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'glass.dart';

/// The microphone, for voice notes: records to a file, says how loud it is meanwhile. Behind an interface so the
/// tests can stand in for it ([VoiceRecorder.override]).
abstract class VoiceRecorder {
  /// The tests' recorder, when set: no microphone involved.
  static VoiceRecorder Function()? override;
  static VoiceRecorder create() => override?.call() ?? _MicRecorder();

  /// False when the person doesn't allow the microphone.
  Future<bool> start();

  /// How loud it is, 0 (silence) to 1, a few times a second while recording.
  Stream<double> get level;

  /// The recording, or null when there's none.
  Future<File?> stop();
  Future<void> cancel();
  void dispose();
}

class _MicRecorder implements VoiceRecorder {
  final _rec = AudioRecorder();
  String? _path;
  @override
  Future<bool> start() async {
    if (!await _rec.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    _path = '${dir.path}/voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
    // speech, not music: mono AAC at 16 kHz is what speech recognition reads, and small to send
    await _rec.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        sampleRate: 16000,
        numChannels: 1,
        bitRate: 48000,
      ),
      path: _path!,
    );
    return true;
  }

  @override
  Stream<double> get level => _rec
      .onAmplitudeChanged(const Duration(milliseconds: 90))
      // dBFS: about -45 is a quiet room, 0 is as loud as it gets
      .map((a) => ((a.current + 45) / 45).clamp(0.0, 1.0));

  @override
  Future<File?> stop() async {
    final path = await _rec.stop();
    return path == null ? null : File(path);
  }

  @override
  Future<void> cancel() async {
    await _rec.cancel();
  }

  @override
  void dispose() => _rec.dispose();
}

/// The message box: what's attached above, then a row of the tray (>), the field, and one button: the mic while
/// there's nothing typed (hold to talk), Send once there is, Stop while the agent works.
class Composer extends StatefulWidget {
  final TextEditingController controller;

  /// Above the field: the moment noted, attached files, the model and credits.
  final List<Widget> header;

  /// The tray's own buttons (attach, mention…), shown inline when > is open.
  final List<Widget> tray;
  final bool busy, sending, canSend;
  final VoidCallback onSend, onStop;
  final ValueChanged<String> onChanged;

  /// Turns a voice note into text (on the computer).
  final Future<String> Function(File note) hear;

  /// A voice note that didn't come through: what went wrong, and the note to try again with.
  final void Function(Object error, File note) onVoiceError;
  const Composer({
    super.key,
    required this.controller,
    required this.header,
    required this.tray,
    required this.busy,
    required this.sending,
    required this.canSend,
    required this.onSend,
    required this.onStop,
    required this.onChanged,
    required this.hear,
    required this.onVoiceError,
  });
  @override
  State<Composer> createState() => ComposerState();
}

/// Where a voice note is: none, being recorded, being turned into text.
enum VoiceStage { idle, recording, hearing }

class ComposerState extends State<Composer> {
  bool trayOpen = false;

  /// After one of the tray's actions: the composer goes back to its size.
  void closeTray() {
    if (trayOpen) setState(() => trayOpen = false);
  }

  VoiceStage voice = VoiceStage.idle;
  VoiceRecorder? _recorder;
  StreamSubscription<double>? _levels;
  final levels = <double>[];
  DateTime _since = DateTime.now();
  Timer? _tick, _limit;

  /// How far the finger has slid toward cancelling: 0 at rest, 1 there.
  final cancelling = ValueNotifier<double>(0);
  static const _cancelAt = 110.0;

  /// The longest voice note: past it, it stops by itself and is heard.
  static const maxNote = Duration(minutes: 15);

  @override
  void dispose() {
    _levels?.cancel();
    _tick?.cancel();
    _limit?.cancel();
    _recorder?.cancel();
    _recorder?.dispose();
    cancelling.dispose();
    super.dispose();
  }

  Future<void> _startVoice() async {
    if (voice != VoiceStage.idle) return;
    final rec = VoiceRecorder.create();
    HapticFeedback.mediumImpact();
    setState(() {
      voice = VoiceStage.recording;
      levels.clear();
      _since = DateTime.now();
      cancelling.value = 0;
    });
    if (!await rec.start()) {
      rec.dispose();
      if (!mounted) return;
      setState(() => voice = VoiceStage.idle);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Allow the microphone for AgentShot to talk your notes.',
          ),
        ),
      );
      return;
    }
    _recorder = rec;
    _levels = rec.level.listen((v) {
      if (!mounted) return;
      setState(() {
        levels.add(v);
        if (levels.length > 48) levels.removeAt(0);
      });
    });
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    _limit = Timer(maxNote, () => _endVoice(cancel: false));
  }

  Future<void> _endVoice({required bool cancel}) async {
    final rec = _recorder;
    if (voice != VoiceStage.recording || rec == null) return;
    _recorder = null;
    unawaited(_levels?.cancel());
    _tick?.cancel();
    _limit?.cancel();
    if (cancel) {
      await rec.cancel();
      rec.dispose();
      HapticFeedback.lightImpact();
      if (mounted) setState(() => voice = VoiceStage.idle);
      return;
    }
    // too short to be a note (under about half a second of sound came in): a tap, really
    final heard = levels.length;
    final note = await rec.stop();
    rec.dispose();
    if (note == null || heard < 5) {
      if (mounted) {
        setState(() => voice = VoiceStage.idle);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Hold the mic while you talk, then let go.'),
          ),
        );
      }
      return;
    }
    await hear(note);
  }

  /// Turns [note] into text in the field (after what's there), or says why it couldn't.
  Future<void> hear(File note) async {
    if (!mounted) return;
    setState(() => voice = VoiceStage.hearing);
    try {
      final said = (await widget.hear(note)).trim();
      if (!mounted) return;
      if (said.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Nothing to hear in that one. Try again, a little closer.',
            ),
          ),
        );
      } else {
        final before = widget.controller.text.trimRight();
        widget.controller.text = before.isEmpty ? said : '$before $said';
        widget.controller.selection = TextSelection.collapsed(
          offset: widget.controller.text.length,
        );
        widget.onChanged(widget.controller.text);
      }
      unawaited(note.delete().catchError((_) => note));
    } catch (e) {
      widget.onVoiceError(e, note);
    } finally {
      if (mounted) setState(() => voice = VoiceStage.idle);
    }
  }

  String get _elapsed {
    final s = DateTime.now().difference(_since).inSeconds;
    return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final typed = widget.controller.text.trim().isNotEmpty;
    final recording = voice == VoiceStage.recording;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: recording ? scheme.primary : scheme.outlineVariant,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.header.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: widget.header,
              ),
            ),
          if (trayOpen && !recording)
            Padding(
              key: const ValueKey('tray'),
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 6),
              child: Wrap(spacing: 8, runSpacing: 8, children: widget.tray),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (!recording)
                IconButton(
                  tooltip: 'Add',
                  onPressed: () => setState(() => trayOpen = !trayOpen),
                  icon: AnimatedRotation(
                    turns: trayOpen ? .25 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: const Icon(Icons.chevron_right),
                  ),
                ),
              Expanded(
                child: switch (voice) {
                  VoiceStage.recording => ValueListenableBuilder<double>(
                    valueListenable: cancelling,
                    builder: (context, c, _) => Padding(
                      key: const ValueKey('recording'),
                      padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
                      child: Row(
                        children: [
                          Icon(
                            Icons.fiber_manual_record,
                            size: 14,
                            color: c > .99
                                ? scheme.onSurfaceVariant
                                : scheme.error,
                          ),
                          const SizedBox(width: 6),
                          Text(_elapsed, style: text.labelLarge),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Waveform(
                              levels: levels,
                              color: Color.lerp(
                                scheme.primary,
                                scheme.error,
                                c,
                              )!,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            c > .99 ? 'Let go to cancel' : '‹ Slide to cancel',
                            style: text.labelMedium?.copyWith(
                              color: c > .99
                                  ? scheme.error
                                  : scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  VoiceStage.hearing => Padding(
                    key: const ValueKey('hearing'),
                    padding: const EdgeInsets.fromLTRB(4, 12, 4, 12),
                    child: Row(
                      children: [
                        const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 10),
                        Flexible(
                          child: Text(
                            'Turning your voice into text…',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    ),
                  ),
                  VoiceStage.idle => Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 4),
                    child: TextField(
                      key: const ValueKey('composer'),
                      controller: widget.controller,
                      minLines: 1,
                      maxLines: 6,
                      textCapitalization: TextCapitalization.sentences,
                      style: text.bodyLarge,
                      decoration: const InputDecoration(
                        hintText: 'Ask for a change…',
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 10),
                      ),
                      onChanged: widget.onChanged,
                    ),
                  ),
                },
              ),
              const SizedBox(width: 4),
              if (widget.busy && !typed)
                IconButton.filled(
                  tooltip: 'Stop',
                  onPressed: widget.onStop,
                  style: IconButton.styleFrom(
                    backgroundColor: scheme.onSurface,
                    foregroundColor: scheme.surface,
                  ),
                  icon: const Icon(Icons.stop_rounded),
                )
              else if (typed && !recording)
                IconButton.filled(
                  tooltip: 'Send',
                  onPressed: widget.canSend ? widget.onSend : null,
                  icon: widget.sending
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.arrow_upward),
                )
              else
                // hold to talk; slide left to cancel; let go to turn it into text
                GestureDetector(
                  key: const ValueKey('mic'),
                  onLongPressStart: (_) => _startVoice(),
                  onLongPressMoveUpdate: (d) => cancelling.value =
                      (-d.offsetFromOrigin.dx / _cancelAt).clamp(0.0, 1.0),
                  onLongPressEnd: (_) =>
                      _endVoice(cancel: cancelling.value > .99),
                  onLongPressCancel: () => _endVoice(cancel: true),
                  // (not a tooltip: on a phone a tooltip shows on a long press, and would take the hold)
                  child: Semantics(
                    button: true,
                    label: 'Hold to talk',
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      width: recording ? 56 : 48,
                      height: recording ? 56 : 48,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: recording
                            ? scheme.primary
                            : scheme.surfaceContainerHigh,
                        boxShadow: recording
                            ? [
                                BoxShadow(
                                  color: scheme.primary.withValues(alpha: .35),
                                  blurRadius:
                                      18 * (levels.lastOrNull ?? .3) + 6,
                                ),
                              ]
                            : null,
                      ),
                      child: Icon(
                        voice == VoiceStage.hearing
                            ? Icons.more_horiz
                            : Icons.mic_none_rounded,
                        color: recording
                            ? scheme.onPrimary
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// How loud the voice was, as bars moving left: the newest at the right.
class Waveform extends StatelessWidget {
  final List<double> levels;
  final Color color;
  const Waveform({super.key, required this.levels, required this.color});
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 26,
    child: CustomPaint(painter: _Bars(levels, color), size: Size.infinite),
  );
}

class _Bars extends CustomPainter {
  final List<double> levels;
  final Color color;
  _Bars(this.levels, this.color);
  @override
  void paint(Canvas canvas, Size size) {
    const gap = 3.0, width = 3.0;
    final count = (size.width / (gap + width)).floor();
    final paint = Paint()
      ..color = color
      ..strokeCap = StrokeCap.round
      ..strokeWidth = width;
    for (var i = 0; i < count; i++) {
      final at = levels.length - count + i;
      final v = at >= 0 ? levels[at] : 0.0;
      final h = max(3.0, v * size.height);
      final x = i * (gap + width) + width / 2;
      canvas.drawLine(
        Offset(x, (size.height - h) / 2),
        Offset(x, (size.height + h) / 2),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_Bars old) => true;
}

/// A chip in the composer's top row (the model, the credits): small, rounded, tappable when it does something.
class ComposerChip extends StatelessWidget {
  final Widget label;
  final IconData? icon;
  final VoidCallback? onTap;
  const ComposerChip({super.key, required this.label, this.icon, this.onTap});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 200),
      child: GlassPill(
        onTap: onTap,
        padding: const EdgeInsets.fromLTRB(12, 7, 10, 7),
        icon: icon,
        iconColor: scheme.onSurfaceVariant,
        label: DefaultTextStyle.merge(
          style: Theme.of(context).textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(child: label),
              if (onTap != null) Icon(Icons.expand_more_rounded, size: 16, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

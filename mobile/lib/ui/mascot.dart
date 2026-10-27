import 'dart:math';
import 'package:flutter/material.dart';

/// Manul, the desktop's editing companion, as the phone shows it: the portrait, breathing slowly while it waits, and
/// while the agent thinks and works the desktop's own 3D Manul running (its frames, recorded by
/// scripts/mascot-run-frames.mjs). Still when the phone asks for less motion.
class Mascot extends StatefulWidget {
  final double size;

  /// The agent is working: a quicker bob instead of a slow breath.
  final bool busy;
  const Mascot({super.key, this.size = 112, this.busy = false});
  @override
  State<Mascot> createState() => _MascotState();
}

class _MascotState extends State<Mascot> with SingleTickerProviderStateMixin {
  late final AnimationController motion = AnimationController(
    vsync: this,
    duration: period,
  );

  // two strides of the run, the loop the frames make
  Duration get period => widget.busy
      ? const Duration(milliseconds: 1142)
      : const Duration(milliseconds: 3200);

  static const runFrames = 28;
  static final run = [
    for (var i = 0; i < runFrames; i++)
      AssetImage('assets/manul_run/${i.toString().padLeft(2, '0')}.webp'),
  ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    sync();
  }

  @override
  void didUpdateWidget(Mascot old) {
    super.didUpdateWidget(old);
    if (old.busy != widget.busy) {
      motion.duration = period;
      sync();
    }
  }

  void sync() {
    if (widget.busy) {
      for (final f in run) {
        precacheImage(f, context);
      }
    }
    if (MediaQuery.disableAnimationsOf(context)) {
      motion.stop();
    } else {
      motion.repeat();
    }
  }

  @override
  void dispose() {
    motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final image = Image.asset(
      'assets/manul.png',
      width: widget.size,
      height: widget.size,
      cacheWidth: (widget.size * MediaQuery.devicePixelRatioOf(context))
          .round(),
      semanticLabel: widget.busy
          ? 'Manul, working on your edit'
          : 'Manul, your editing companion',
    );
    final still = MediaQuery.disableAnimationsOf(context);
    return SizedBox.square(
      dimension: widget.size,
      child: AnimatedBuilder(
        animation: motion,
        builder: (context, child) {
          // working: Manul runs (the desktop's run, frame by frame)
          if (widget.busy && !still) {
            final i = (motion.value * runFrames).floor() % runFrames;
            return Image(
              image: run[i],
              width: widget.size,
              height: widget.size,
              fit: BoxFit.contain,
              gaplessPlayback: true,
              semanticLabel: 'Manul, working on your edit',
            );
          }
          final wave = sin(motion.value * 2 * pi);
          // a slow breath
          return Transform.scale(
            scale: 1 + (widget.busy ? 0 : .025 * (wave + 1) / 2),
            alignment: Alignment.bottomCenter,
            child: child,
          );
        },
        child: image,
      ),
    );
  }
}

import 'dart:math';
import 'package:flutter/material.dart';

/// Manul, the desktop's editing companion, as the phone shows it: the same portrait, breathing slowly while it waits
/// and bobbing along while the agent works. (The desktop draws a 3D Manul; on the phone a light animation of the
/// portrait does the job.) Still when the phone asks for less motion.
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

  Duration get period => widget.busy
      ? const Duration(milliseconds: 520)
      : const Duration(milliseconds: 3200);

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
    return SizedBox.square(
      dimension: widget.size,
      child: AnimatedBuilder(
        animation: motion,
        builder: (context, child) {
          final wave = sin(motion.value * 2 * pi);
          return widget.busy
              // a little run: up and down, rocking side to side
              ? Transform.translate(
                  offset: Offset(0, -widget.size * .06 * wave.abs()),
                  child: Transform.rotate(angle: .05 * wave, child: child),
                )
              // a slow breath
              : Transform.scale(
                  scale: 1 + .025 * (wave + 1) / 2,
                  alignment: Alignment.bottomCenter,
                  child: child,
                );
        },
        child: image,
      ),
    );
  }
}

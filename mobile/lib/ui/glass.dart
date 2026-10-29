import 'package:flutter/material.dart';

/// Glass: a near-opaque tint with a fine bright edge, for things that float over the conversation (the way back down,
/// the composer's chips) so they sit on it rather than cover it. No live blur: over a list that scrolls, it would be
/// drawn again every frame, and scrolling would stutter.
class Glass extends StatelessWidget {
  final Widget child;
  final BorderRadius radius;

  /// Lifted off the page with a soft shadow (for what floats).
  final bool raised;
  const Glass({
    super.key,
    required this.child,
    this.radius = const BorderRadius.all(Radius.circular(999)),
    this.raised = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: raised
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? .45 : .12),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                ),
              ]
            : null,
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: radius,
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                scheme.surfaceContainerHighest.withValues(alpha: .96),
                scheme.surfaceContainerHigh.withValues(alpha: .94),
              ],
            ),
            border: Border.all(
              color: dark
                  ? Colors.white.withValues(alpha: .14)
                  : Colors.white.withValues(alpha: .85),
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}

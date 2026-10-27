import 'dart:ui';
import 'package:flutter/material.dart';

/// Frosted glass: what's behind shows through, blurred, under a light tint with a fine bright edge. For things that
/// float over the conversation (the way back down, the composer's chips) so they sit on it rather than cover it.
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
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: radius,
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  scheme.surfaceContainerHighest.withValues(alpha: dark ? .78 : .74),
                  scheme.surfaceContainerHigh.withValues(alpha: dark ? .66 : .62),
                ],
              ),
              border: Border.all(
                color: dark ? Colors.white.withValues(alpha: .14) : Colors.white.withValues(alpha: .85),
              ),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// A round glass pill to tap: an icon and a few words.
class GlassPill extends StatelessWidget {
  final Widget label;
  final IconData? icon;
  final Color? iconColor;
  final VoidCallback? onTap;
  final bool raised;

  /// The icon on a small accent disc: for the one pill that should catch the eye.
  final bool accent;
  final EdgeInsets padding;
  const GlassPill({
    super.key,
    required this.label,
    this.icon,
    this.iconColor,
    this.onTap,
    this.raised = false,
    this.accent = false,
    this.padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Glass(
      raised: raised,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: padding,
            child: DefaultTextStyle.merge(
              style: Theme.of(context).textTheme.labelLarge?.copyWith(color: scheme.onSurface),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null && accent) ...[
                    Container(
                      width: 24,
                      height: 24,
                      margin: const EdgeInsets.only(left: 2),
                      decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle),
                      child: Icon(icon, size: 16, color: scheme.onPrimary),
                    ),
                    const SizedBox(width: 8),
                  ] else if (icon != null) ...[
                    Icon(icon, size: 17, color: iconColor ?? scheme.primary),
                    const SizedBox(width: 6),
                  ],
                  Flexible(child: label),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

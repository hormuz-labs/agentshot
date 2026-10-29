import 'package:flutter/material.dart';

/// AgentShot's design system: one place for colour, type, space and shape, so every screen reads as one product.
///
/// The idea: a studio, not a settings app. The film is the brightest thing on screen, so the canvas is a warm near-black
/// (a warm paper in light mode) and the interface steps back in three surface levels separated by hairlines, not
/// boxes. Amber is the one colour that means "do this" (the primary action, what's selected, the playhead); the
/// spark gradient (amber into coral) is kept for what the AI does (send a note, make something). Type is Inter,
/// small and mostly regular (as Instagram does it): bold only for page titles, semibold for buttons and section
/// names, and tabular figures for timecodes. Words are few: an icon, or one or two words, where a sentence was. Corners are
/// continuous (superellipse), sized by how big the thing is: chips 10, buttons and fields 14, cards 20, sheets 28.

/// Spacing steps: everything sits on a 4-point grid.
abstract final class Space {
  static const double xs = 4, sm = 8, md = 12, lg = 16, xl = 20, xxl = 24, xxxl = 32;

  /// The page's side margin on a phone.
  static const double page = 20;
}

/// Corner radii, by the size of the thing.
abstract final class Radii {
  static const double chip = 10, control = 14, card = 20, sheet = 28;
}

/// A continuous (superellipse) rounded shape: softer than a plain rounded rectangle, like the system's own.
OutlinedBorder smooth(double radius, {BorderSide side = BorderSide.none}) =>
    RoundedSuperellipseBorder(borderRadius: BorderRadius.circular(radius), side: side);

/// Motion: quick and eased, never bouncy.
abstract final class Motion {
  static const fast = Duration(milliseconds: 140);
  static const normal = Duration(milliseconds: 220);
  static const slow = Duration(milliseconds: 360);
  static const curve = Curves.easeOutCubic;
}

/// The colours a screen reaches for beyond Material's scheme.
@immutable
class Studio extends ThemeExtension<Studio> {
  /// The page behind everything.
  final Color canvas;

  /// Cards, sheets, the nav bar; then fields and controls on them; then what's pressed or selected.
  final Color surface1, surface2, surface3;

  /// The fine lines that separate, instead of boxes.
  final Color hairline;

  /// Secondary and tertiary text.
  final Color text2, text3;

  /// The one colour that means "do this", what sits on it, and its quiet tint.
  final Color accent, onAccent, accentSoft;

  /// What the AI does: amber into coral.
  final Gradient spark;
  final Color success, danger, info;

  /// Behind a film (the letterbox).
  final Color film;
  const Studio({
    required this.canvas,
    required this.surface1,
    required this.surface2,
    required this.surface3,
    required this.hairline,
    required this.text2,
    required this.text3,
    required this.accent,
    required this.onAccent,
    required this.accentSoft,
    required this.spark,
    required this.success,
    required this.danger,
    required this.info,
    required this.film,
  });

  static const _amber = Color(0xfff5a524), _coral = Color(0xffff6b4a);
  static const _spark = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [_amber, _coral],
  );

  static const dark = Studio(
    canvas: Color(0xff0e0d0c),
    surface1: Color(0xff171513),
    surface2: Color(0xff211e1b),
    surface3: Color(0xff2c2824),
    hairline: Color(0x14ffffff),
    text2: Color(0xffaaa196),
    text3: Color(0xff746b61),
    accent: _amber,
    onAccent: Color(0xff1a1105),
    accentSoft: Color(0x24f5a524),
    spark: _spark,
    success: Color(0xff3dd68c),
    danger: Color(0xffff5a5f),
    info: Color(0xff5ab0ff),
    film: Color(0xff000000),
  );

  static const light = Studio(
    canvas: Color(0xfff6f4f1),
    surface1: Color(0xffffffff),
    surface2: Color(0xffefece8),
    surface3: Color(0xffe5e1db),
    hairline: Color(0x16000000),
    text2: Color(0xff6b6359),
    text3: Color(0xff9a9187),
    accent: _amber,
    onAccent: Color(0xff1a1105),
    accentSoft: Color(0x2ef5a524),
    spark: _spark,
    success: Color(0xff12a15e),
    danger: Color(0xffd93a3f),
    info: Color(0xff1f7fd6),
    film: Color(0xff0e0d0c),
  );

  /// The theme's studio colours (or the ones for its brightness, under a theme made without them).
  static Studio of(BuildContext context) {
    final theme = Theme.of(context);
    return theme.extension<Studio>() ?? (theme.brightness == Brightness.dark ? dark : light);
  }

  @override
  Studio copyWith() => this;

  @override
  Studio lerp(Studio? other, double t) {
    if (other == null) return this;
    Color c(Color a, Color b) => Color.lerp(a, b, t)!;
    return Studio(
      canvas: c(canvas, other.canvas),
      surface1: c(surface1, other.surface1),
      surface2: c(surface2, other.surface2),
      surface3: c(surface3, other.surface3),
      hairline: c(hairline, other.hairline),
      text2: c(text2, other.text2),
      text3: c(text3, other.text3),
      accent: c(accent, other.accent),
      onAccent: c(onAccent, other.onAccent),
      accentSoft: c(accentSoft, other.accentSoft),
      spark: t < .5 ? spark : other.spark,
      success: c(success, other.success),
      danger: c(danger, other.danger),
      info: c(info, other.info),
      film: c(film, other.film),
    );
  }
}

/// Timecodes and counts: figures of one width, so they don't jitter as they change.
const tabular = [FontFeature.tabularFigures()];

TextTheme _type(Color ink, Color quiet) {
  TextStyle s(double size, FontWeight weight, double tracking, double height, [Color? color]) => TextStyle(
    fontFamily: 'Inter',
    fontSize: size,
    fontWeight: weight,
    letterSpacing: tracking,
    height: height,
    color: color ?? ink,
  );
  return TextTheme(
    // the one big moment on a screen (a home title)
    displaySmall: s(24, FontWeight.w700, -0.5, 1.15),
    // screen titles
    headlineLarge: s(24, FontWeight.w700, -0.5, 1.15),
    headlineMedium: s(22, FontWeight.w700, -0.4, 1.2),
    headlineSmall: s(19, FontWeight.w600, -0.3, 1.25),
    // section and card titles
    titleLarge: s(17, FontWeight.w600, -0.2, 1.3),
    titleMedium: s(15, FontWeight.w500, -0.1, 1.3),
    titleSmall: s(14, FontWeight.w500, 0, 1.3),
    // reading
    bodyLarge: s(15, FontWeight.w400, 0, 1.4),
    bodyMedium: s(14, FontWeight.w400, 0, 1.4),
    bodySmall: s(12.5, FontWeight.w400, 0, 1.35, quiet),
    // buttons, chips, tabs
    labelLarge: s(14, FontWeight.w600, 0, 1.2),
    labelMedium: s(13, FontWeight.w500, 0, 1.2),
    labelSmall: s(11, FontWeight.w500, 0.1, 1.2),
  );
}

ThemeData agentShotTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final studio = dark ? Studio.dark : Studio.light;
  final ink = dark ? const Color(0xfff4efe8) : const Color(0xff171512);
  final scheme =
      ColorScheme.fromSeed(seedColor: studio.accent, brightness: brightness).copyWith(
        primary: dark ? studio.accent : const Color(0xffb86a00),
        onPrimary: dark ? studio.onAccent : Colors.white,
        primaryContainer: studio.accentSoft,
        onPrimaryContainer: ink,
        secondary: studio.info,
        error: studio.danger,
        surface: studio.canvas,
        onSurface: ink,
        onSurfaceVariant: studio.text2,
        outline: studio.text3,
        outlineVariant: studio.hairline,
        surfaceContainerLowest: studio.canvas,
        surfaceContainerLow: studio.surface1,
        surfaceContainer: studio.surface1,
        surfaceContainerHigh: studio.surface2,
        surfaceContainerHighest: studio.surface3,
        surfaceTint: Colors.transparent,
        shadow: Colors.black,
      );
  final text = _type(ink, studio.text2);
  final control = smooth(Radii.control);
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    fontFamily: 'Inter',
    textTheme: text,
    extensions: [studio],
    scaffoldBackgroundColor: studio.canvas,
    canvasColor: studio.canvas,
    dividerColor: studio.hairline,
    splashFactory: InkSparkle.splashFactory,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    appBarTheme: AppBarTheme(
      backgroundColor: studio.canvas,
      foregroundColor: ink,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
      titleSpacing: Space.page,
      titleTextStyle: text.titleLarge,
    ),
    iconTheme: IconThemeData(color: ink, size: 22),
    dividerTheme: DividerThemeData(color: studio.hairline, thickness: 1, space: 1),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: studio.accent,
        foregroundColor: studio.onAccent,
        disabledBackgroundColor: studio.surface3,
        disabledForegroundColor: studio.text3,
        minimumSize: const Size(48, 46),
        padding: const EdgeInsets.symmetric(horizontal: 22),
        shape: control,
        textStyle: text.labelLarge,
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        backgroundColor: studio.surface2,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 18),
        shape: control,
        side: BorderSide(color: studio.hairline),
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: scheme.primary,
        minimumSize: const Size(44, 44),
        shape: smooth(12),
        textStyle: text.labelLarge,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(shape: control, elevation: 0, backgroundColor: studio.surface2),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: const Size(44, 44), shape: smooth(12)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        shape: WidgetStatePropertyAll(smooth(12)),
        side: WidgetStatePropertyAll(BorderSide(color: studio.hairline)),
        textStyle: WidgetStatePropertyAll(text.labelMedium),
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? studio.accentSoft : studio.surface2,
        ),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: smooth(Radii.chip),
      side: BorderSide.none,
      backgroundColor: studio.surface2,
      selectedColor: studio.accentSoft,
      labelStyle: text.labelMedium,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      showCheckmark: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: studio.surface2,
      hintStyle: text.bodyLarge?.copyWith(color: studio.text3),
      labelStyle: text.bodyMedium?.copyWith(color: studio.text2),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.control),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.control),
        borderSide: BorderSide(color: studio.hairline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.control),
        borderSide: BorderSide(color: studio.accent, width: 1.5),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: Space.md),
      color: studio.surface1,
      shape: smooth(Radii.card, side: BorderSide(color: studio.hairline)),
    ),
    listTileTheme: ListTileThemeData(
      shape: smooth(Radii.control),
      iconColor: studio.text2,
      titleTextStyle: text.titleSmall,
      subtitleTextStyle: text.bodySmall,
      minVerticalPadding: 10,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: studio.surface1,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: studio.surface1,
      showDragHandle: true,
      // a handle you can see: the sheet can be dragged (down to close, up when it's tall)
      dragHandleColor: studio.text3,
      dragHandleSize: const Size(44, 5),
      shape: const RoundedSuperellipseBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.sheet)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: studio.surface1,
      surfaceTintColor: Colors.transparent,
      shape: smooth(24),
      titleTextStyle: text.titleLarge,
      contentTextStyle: text.bodyMedium?.copyWith(color: studio.text2),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: studio.surface2,
      surfaceTintColor: Colors.transparent,
      shape: smooth(Radii.control, side: BorderSide(color: studio.hairline)),
      textStyle: text.bodyMedium,
      elevation: 8,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: dark ? studio.surface3 : const Color(0xff1f1c19),
      contentTextStyle: text.bodyMedium?.copyWith(color: const Color(0xfff4efe8)),
      actionTextColor: studio.accent,
      shape: smooth(Radii.control),
      elevation: 0,
    ),
    sliderTheme: SliderThemeData(
      trackHeight: 3,
      activeTrackColor: studio.accent,
      inactiveTrackColor: studio.surface3,
      thumbColor: studio.accent,
      overlayColor: studio.accentSoft,
      thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: studio.accent,
      linearTrackColor: studio.surface3,
      circularTrackColor: Colors.transparent,
      linearMinHeight: 3,
      borderRadius: BorderRadius.circular(2),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? studio.onAccent : studio.text2,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? studio.accent : studio.surface3,
      ),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    badgeTheme: BadgeThemeData(backgroundColor: studio.accent, textColor: studio.onAccent),
    tooltipTheme: TooltipThemeData(
      decoration: ShapeDecoration(color: studio.surface3, shape: smooth(8)),
      textStyle: text.labelMedium,
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: studio.canvas,
      indicatorColor: studio.accentSoft,
      indicatorShape: smooth(Radii.control),
      selectedIconTheme: IconThemeData(color: studio.accent),
      unselectedIconTheme: IconThemeData(color: studio.text2),
      selectedLabelTextStyle: text.labelMedium,
      unselectedLabelTextStyle: text.labelMedium?.copyWith(color: studio.text2),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: studio.accent,
      foregroundColor: studio.onAccent,
      shape: smooth(18),
      elevation: 2,
    ),
  );
}

/// A raised panel on the page: a card's look without Card's margins.
class Panel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final double radius;

  /// A thin accent edge: for the one panel that's waiting on the person.
  final bool highlight;
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Space.lg),
    this.onTap,
    this.color,
    this.radius = Radii.card,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final shape = smooth(
      radius,
      side: BorderSide(color: highlight ? studio.accent.withValues(alpha: .55) : studio.hairline),
    );
    return Material(
      color: color ?? studio.surface1,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

/// A small, quiet label above a group.
class Overline extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const Overline(this.text, {super.key, this.trailing});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.sm),
    child: Row(
      children: [
        Text(
          text,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(color: Studio.of(context).text3),
        ),
        // what goes with it, at the far end, cut short when it doesn't fit
        if (trailing case final t?) ...[
          const SizedBox(width: Space.md),
          Expanded(
            child: Align(
              alignment: Alignment.centerRight,
              child: DefaultTextStyle.merge(maxLines: 1, overflow: TextOverflow.ellipsis, child: t),
            ),
          ),
        ],
      ],
    ),
  );
}

/// A word or two about state, on a tinted lozenge (Working…, Needs your OK, New reply). [live] adds a pulsing dot.
class StatusPill extends StatelessWidget {
  final String label;
  final Color color;
  final bool live;

  /// On a picture: a dark backing so it reads over any frame.
  final bool onMedia;
  const StatusPill(this.label, {super.key, required this.color, this.live = false, this.onMedia = false});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(8, 4, 10, 4),
    decoration: ShapeDecoration(
      color: onMedia ? Colors.black.withValues(alpha: .62) : color.withValues(alpha: .14),
      shape: smooth(8),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        live ? _Pulse(color: color) : Icon(Icons.circle, size: 7, color: color),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: onMedia ? Colors.white : color,
              letterSpacing: 0.1,
            ),
          ),
        ),
      ],
    ),
  );
}

class _Pulse extends StatefulWidget {
  final Color color;
  const _Pulse({required this.color});
  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));
  @override
  void initState() {
    super.initState();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // with reduced motion, a dot that doesn't move (as Manul keeps still)
    if (MediaQuery.disableAnimationsOf(context)) {
      controller.value = 1;
      controller.stop();
    } else if (!controller.isAnimating) {
      controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: Tween(begin: .35, end: 1.0).animate(controller),
    child: Icon(Icons.circle, size: 7, color: widget.color),
  );
}

/// A button with the spark gradient: for asking the AI to make something.
class SparkButton extends StatelessWidget {
  final Widget label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expand;
  const SparkButton({super.key, required this.label, this.icon, this.onPressed, this.expand = false});

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final enabled = onPressed != null;
    return Semantics(
      button: true,
      enabled: enabled,
      child: Material(
        shape: smooth(Radii.control),
        clipBehavior: Clip.antiAlias,
        color: Colors.transparent,
        child: Ink(
          decoration: ShapeDecoration(
            gradient: enabled ? studio.spark : null,
            color: enabled ? null : studio.surface3,
            shape: smooth(Radii.control),
          ),
          child: InkWell(
            onTap: onPressed,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 50, minWidth: 50),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 19, color: enabled ? studio.onAccent : studio.text3),
                      const SizedBox(width: 8),
                    ],
                    DefaultTextStyle.merge(
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: enabled ? studio.onAccent : studio.text3,
                      ),
                      child: label,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A square-ish icon button on a surface tile (in headers and toolbars).
class TileButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool accent;
  const TileButton({super.key, required this.icon, required this.tooltip, this.onPressed, this.accent = false});

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: accent ? studio.accent : studio.surface2,
        foregroundColor: accent ? studio.onAccent : Theme.of(context).colorScheme.onSurface,
        fixedSize: const Size(44, 44),
        shape: smooth(Radii.control),
        side: accent ? null : BorderSide(color: studio.hairline),
      ),
      icon: Icon(icon, size: 21),
    );
  }
}

/// Every sheet in the app comes up through here: from the bottom, with its handle on top, and its content kept above
/// the strip at the very bottom of the screen where the phone's own swipe (Home, the app switcher) lives, so a drag or
/// tap near the bottom of a sheet never fights the system's gesture.
Future<T?> showSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool useSafeArea = true,
  bool? showDragHandle,
  BoxConstraints? constraints,
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: isScrollControlled,
  useSafeArea: useSafeArea,
  showDragHandle: showDragHandle,
  constraints: constraints,
  builder: (context) => SafeArea(top: false, child: builder(context)),
);

import 'package:flutter/material.dart';

/// A message that slides aside, as the conversation is swiped sideways, to show when it was said.
class Timed extends StatelessWidget {
  /// When it was said (milliseconds since the epoch), if the computer said.
  final num? at;
  final ValueNotifier<double> reveal;
  final Widget child;
  const Timed({
    super.key,
    required this.at,
    required this.reveal,
    required this.child,
  });

  /// 14:05 today; Tue 14:05 this week; 3 Oct 14:05 before that.
  static String when(DateTime t, [DateTime? now]) {
    now ??= DateTime.now();
    final hm =
        '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    final days = DateTime(
      now.year,
      now.month,
      now.day,
    ).difference(DateTime(t.year, t.month, t.day)).inDays;
    if (days == 0) return hm;
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    if (days < 7) return '${weekdays[t.weekday - 1]} $hm';
    return '${t.day} ${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.month - 1]} $hm';
  }

  @override
  Widget build(BuildContext context) {
    final a = at;
    if (a == null) return child;
    final label = when(DateTime.fromMillisecondsSinceEpoch(a.toInt()));
    return ValueListenableBuilder<double>(
      valueListenable: reveal,
      child: child,
      builder: (context, v, child) => v == 0
          ? child!
          : Stack(
              clipBehavior: Clip.none,
              children: [
                Transform.translate(offset: Offset(-64 * v, 0), child: child),
                Positioned(
                  right: 0,
                  top: 0,
                  bottom: 18,
                  child: Center(
                    child: Opacity(
                      opacity: v,
                      child: Text(
                        label,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

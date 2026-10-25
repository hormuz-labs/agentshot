import 'package:flutter/material.dart';

/// Google's "G" mark, drawn from the official 18×18 paths of the Sign in with Google button (no image asset).
class GoogleLogo extends StatelessWidget {
  final double size;
  const GoogleLogo({super.key, this.size = 20});
  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _GooglePainter());
}

class _GooglePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 18, size.height / 18);
    void fill(int color, Path path) =>
        canvas.drawPath(path, Paint()..color = Color(color));

    // blue
    fill(
      0xFF4285F4,
      Path()
        ..moveTo(17.64, 9.2)
        ..relativeCubicTo(0, -.637, -.057, -1.251, -.164, -1.84)
        ..lineTo(9, 7.36)
        ..relativeLineTo(0, 3.481)
        ..relativeLineTo(4.844, 0)
        ..relativeCubicTo(-.209, 1.125, -.843, 2.078, -1.796, 2.717)
        ..relativeLineTo(0, 2.258)
        ..relativeLineTo(2.908, 0)
        ..relativeCubicTo(1.702, -1.567, 2.684, -3.874, 2.684, -6.615)
        ..close(),
    );
    // green
    fill(
      0xFF34A853,
      Path()
        ..moveTo(9, 18)
        ..relativeCubicTo(2.43, 0, 4.467, -.806, 5.956, -2.18)
        ..relativeLineTo(-2.908, -2.259)
        ..relativeCubicTo(-.806, .54, -1.837, .86, -3.048, .86)
        ..relativeCubicTo(-2.344, 0, -4.328, -1.584, -5.036, -3.711)
        ..lineTo(.957, 10.71)
        ..relativeLineTo(0, 2.332)
        ..arcToPoint(
          const Offset(9, 18),
          radius: const Radius.circular(8.997),
          clockwise: false,
        )
        ..close(),
    );
    // yellow
    fill(
      0xFFFBBC05,
      Path()
        ..moveTo(3.964, 10.71)
        ..arcToPoint(
          const Offset(3.682, 9),
          radius: const Radius.circular(5.41),
        )
        ..relativeCubicTo(0, -.593, .102, -1.17, .282, -1.71)
        ..lineTo(3.964, 4.958)
        ..lineTo(.957, 4.958)
        ..arcToPoint(
          const Offset(0, 9),
          radius: const Radius.circular(8.996),
          clockwise: false,
        )
        ..relativeCubicTo(0, 1.452, .348, 2.827, .957, 4.042)
        ..relativeLineTo(3.007, -2.332)
        ..close(),
    );
    // red
    fill(
      0xFFEA4335,
      Path()
        ..moveTo(9, 3.58)
        ..relativeCubicTo(1.321, 0, 2.508, .454, 3.44, 1.345)
        ..relativeLineTo(2.582, -2.58)
        ..cubicTo(13.463, .891, 11.426, 0, 9, 0)
        ..arcToPoint(
          const Offset(.957, 4.958),
          radius: const Radius.circular(8.997),
          clockwise: false,
        )
        ..lineTo(3.964, 7.29)
        ..cubicTo(4.672, 5.163, 6.656, 3.58, 9, 3.58)
        ..close(),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

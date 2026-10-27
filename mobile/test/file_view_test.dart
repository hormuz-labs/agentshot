import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/ui/file_view.dart';

void main() {
  test('a marked part reads as its file and times; a long name gives way to the times', () {
    expect(attachmentLabel('media/Gull flyby.mp4'), 'Gull flyby.mp4');
    expect(attachmentLabel('media/Gull flyby.mp4#t=4.2,9.0'), 'Gull flyby.mp4 · 0:04.2–0:09.0');
    expect(attachmentLabel('renders/jXA3p78sSQmRCdMj.mp4#t=0.0,62.5'), 'jXA3p78sSQ….mp4 · 0:00.0–1:02.5');
  });
}

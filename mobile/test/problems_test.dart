import 'package:agentshot_mobile/bridge/problems.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const fallback = 'Open AgentShot on your computer to see why.';
  group('readableOr', () {
    test('passes a plain sentence from the computer through', () {
      const said =
          'Couldn’t send your notes. A file this needs isn’t on the computer any more: it may have been moved or deleted.';
      expect(readableOr(said, fallback), said);
      expect(
        readableOr(
          'This computer already has 10 paired phones. Remove one in AgentShot → Settings → Mobile, then pair again.',
          fallback,
        ),
        startsWith('This computer already'),
      );
    });
    test('keeps raw errors, paths, codes and logs on the computer', () {
      for (final raw in [
        'Error: spawn ffmpeg ENOENT',
        'ENOENT: no such file or directory, open /Users/a/film.mp4',
        'ffmpeg exited with exit code 1',
        'TypeError: x is undefined\n    at run (main.js:1:2)',
        'Could not read /var/folders/t1/x.mp4',
        'C:\\Users\\a\\film.mp4 is locked',
        'x' * 400,
        '',
        null,
        42,
      ]) {
        expect(readableOr(raw, fallback), fallback, reason: '$raw');
      }
    });
  });
  group('runProblem', () {
    test('turns the AI service’s errors into what to do', () {
      expect(
        runProblem('429 Too Many Requests'),
        contains('too many requests'),
      );
      expect(runProblem('invalid x-api-key (401)'), contains('key'));
      expect(runProblem('weird'), contains('ask again to carry on'));
    });
  });
}

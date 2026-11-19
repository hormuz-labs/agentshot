import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/media_cache.dart';

void main() {
  late Directory root;
  setUp(
    () async =>
        root = await Directory.systemTemp.createTemp('media-cache-test-'),
  );
  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  Future<void> keep(
    MediaCache cache,
    String key,
    String etag,
    List<int> bytes,
  ) async {
    final writer = await cache.write(key, etag, 'video/mp4');
    writer.add(bytes);
    await writer.commit(bytes.length);
  }

  test('keeps a film by its tag and finds it again after a restart', () async {
    final cache = MediaCache(root: () async => root);
    final key = MediaCache.keyOf('computer', '/media', {
      'project': '/p',
      'file': 'cut.mp4',
    });
    expect(await cache.lookup(key), isNull);
    await keep(cache, key, '"a-1"', [1, 2, 3]);
    final (entry, file) = (await cache.lookup(key))!;
    expect(entry.etag, '"a-1"');
    expect(await file.readAsBytes(), [1, 2, 3]);
    expect(cache.recentlyChecked(key), isTrue);
    // the index is written a moment later
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final again = MediaCache(root: () async => root);
    expect((await again.lookup(key))?.$1.etag, '"a-1"');
    expect(again.recentlyChecked(key), isFalse);
  });

  test(
    'a new version replaces the old file; a broken download keeps nothing',
    () async {
      final cache = MediaCache(root: () async => root);
      const key = 'k';
      await keep(cache, key, '"v1"', [1]);
      await keep(cache, key, '"v2"', [2, 2]);
      expect((await cache.lookup(key))!.$1.etag, '"v2"');
      expect(await cache.size(), 2);
      final short = await cache.write('other', '"x"', 'video/mp4');
      short.add([1, 2]);
      await short.commit(10);
      expect(await cache.lookup('other'), isNull);
      // only the current file is left on disk (plus the index)
      await Future<void>.delayed(const Duration(milliseconds: 600));
      final files = root
          .listSync()
          .map((f) => f.path.split('/').last)
          .where((n) => n != 'index.json');
      expect(files, hasLength(1));
    },
  );

  test('keys differ by computer and file', () {
    final a = MediaCache.keyOf('one', '/media', {
      'project': '/p',
      'file': 'a.mp4',
    });
    expect(
      MediaCache.keyOf('two', '/media', {'project': '/p', 'file': 'a.mp4'}),
      isNot(a),
    );
    expect(
      MediaCache.keyOf('one', '/thumbnail', {'project': '/p', 'file': 'a.mp4'}),
      isNot(a),
    );
    expect(
      MediaCache.keyOf('one', '/media', {'file': 'a.mp4', 'project': '/p'}),
      a,
    );
  });

  test(
    'lets the least recently watched go past its limit, and everything on clear',
    () async {
      final cache = MediaCache(root: () async => root, limit: 5);
      await keep(cache, 'old', '"1"', [1, 1, 1]);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await keep(cache, 'new', '"2"', [2, 2, 2]);
      expect(await cache.lookup('old'), isNull);
      expect(await cache.lookup('new'), isNotNull);
      await cache.drop('new');
      expect(await cache.lookup('new'), isNull);
      await keep(cache, 'again', '"3"', [3]);
      await cache.clear();
      expect(await cache.size(), 0);
      expect(await cache.lookup('again'), isNull);
    },
  );
  test(
    'clear invalidates in-flight writers and concurrent commits preserve the budget',
    () async {
      final cache = MediaCache(root: () async => root, limit: 10);
      final writer = await cache.write('old', '"1"', 'video/mp4');
      writer.add([1, 2, 3]);
      await cache.clear();
      await writer.commit(3);
      expect(await cache.lookup('old'), isNull);
      await Future.wait(
        List.generate(12, (i) => keep(cache, 'k$i', '"1"', [i, i, i])),
      );
      await cache.flush();
      expect(await cache.size(), lessThanOrEqualTo(10));
      final again = MediaCache(root: () async => root, limit: 10);
      expect(await again.size(), await cache.size());
      expect(root.listSync().where((f) => f.path.endsWith('.part')), isEmpty);
      await again.clear();
    },
  );
  test('restart removes truncated entries and orphaned downloads', () async {
    final cache = MediaCache(root: () async => root);
    await keep(cache, 'k', '"1"', [1, 2, 3]);
    final file = (await cache.lookup('k'))!.$2;
    await cache.flush();
    await file.writeAsBytes([1]);
    await File('${root.path}/orphan.part').writeAsBytes([4, 5]);
    final again = MediaCache(root: () async => root);
    expect(await again.lookup('k'), isNull);
    expect(await again.size(), 0);
    expect(
      root.listSync().whereType<File>().where(
        (f) => !f.path.endsWith('index.json'),
      ),
      isEmpty,
    );
    await again.clear();
  });
}

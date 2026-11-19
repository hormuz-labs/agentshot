import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

/// A film, sound or picture kept on the phone: which file holds it and the version the computer gave it (its ETag).
class CachedMedia {
  final String name, etag, type;
  final int size;

  /// When it was last played or shown (milliseconds), so the least used goes first when room runs out.
  int used;
  CachedMedia(this.name, this.etag, this.type, this.size, this.used);
  factory CachedMedia.fromJson(Map<String, dynamic> json) => CachedMedia(
    json['name'] as String,
    json['etag'] as String,
    json['type'] as String? ?? 'application/octet-stream',
    json['size'] as int,
    json['used'] as int? ?? 0,
  );
  Map<String, dynamic> toJson() => {
    'name': name,
    'etag': etag,
    'type': type,
    'size': size,
    'used': used,
  };
}

/// Shared disk budget for versioned playback blocks, descriptors and pictures.
///
/// Kept in the app's own storage (not a temporary folder the system empties), up to [limit] bytes: past it, what
/// was least recently watched goes. Everything goes when the phone disconnects from the computer.
class MediaCache {
  /// Where the files live; the app's support folder by default (a test's own folder in tests).
  final Future<Directory> Function() _root;

  /// The most it keeps, in bytes.
  int limit;
  MediaCache({Future<Directory> Function()? root, this.limit = 2 << 30})
    : _root =
          root ??
          (() async => Directory(
            '${(await getApplicationSupportDirectory()).path}/media-cache',
          ));

  Directory? _dir;
  Map<String, CachedMedia>? _index;
  int generation = 0;
  Future<Map<String, CachedMedia>>? _loading;
  Future<void> _mutation = Future.value();
  Future<T> _exclusive<T>(Future<T> Function() run) {
    final next = _mutation.then((_) => run());
    _mutation = next.then<void>((_) {}, onError: (Object _) {});
    return next;
  }

  /// Checked with the computer lately (key → when): checked again only after [recheck].
  final _checked = <String, DateTime>{};
  static Duration recheck = const Duration(minutes: 2);

  /// Picture refreshes, coalesced per key.
  final _filling = <String, Future<void>>{};

  /// Says when what's kept changed (for Settings' storage line).
  final _changes = StreamController<void>.broadcast();
  Stream<void> get changes => _changes.stream;

  Future<Directory> _folder() async =>
      _dir ??= await (await _root()).create(recursive: true);

  Future<Map<String, CachedMedia>> _entries() => _loading ??= _loadEntries().catchError((Object error) {
    _loading = null;
    throw error;
  });
  Future<Map<String, CachedMedia>> _loadEntries() async {
    if (_index case final index?) return index;
    final dir = await _folder();
    final index = <String, CachedMedia>{};
    try {
      final saved =
          jsonDecode(await File('${dir.path}/index.json').readAsString())
              as Map<String, dynamic>;
      for (final MapEntry(:key, :value) in saved.entries) {
        final entry = CachedMedia.fromJson(
          Map<String, dynamic>.from(value as Map),
        );
        // a file the system or a crash took away isn't kept any more
        if (!RegExp(r'^[a-zA-Z0-9_-]+$').hasMatch(entry.name) || entry.size < 0) {
          continue;
        }
        final file = File('${dir.path}/${entry.name}');
        if (await file.exists() && await file.length() == entry.size) {
          index[key] = entry;
        }
      }
    } catch (_) {
      // nothing kept yet, or an index that couldn't be read: start over
    }
    final names = index.values.map((e) => '${dir.path}/${e.name}').toSet();
    // Halves of downloads and unindexed files from an interrupted commit.
    try {
      await for (final f in dir.list()) {
        if (f is File &&
            !f.path.endsWith('/index.json') &&
            !names.contains(f.path)) {
          await f.delete().catchError((_) => File(''));
        }
      }
    } catch (_) {}
    return _index ??= index;
  }

  Timer? _saving;
  void _save() {
    // Continuous playback must persist its index instead of postponing it forever.
    if (_saving?.isActive == true) return;
    _saving = Timer(
      const Duration(milliseconds: 400),
      () => unawaited(flush()),
    );
  }

  /// Persist pending access/commit changes, including when the client shuts down.
  Future<void> flush() {
    _saving?.cancel();
    if (_index == null) return Future.value();
    return _exclusive(() async {
      if (_index == null) return;
      try {
        final dir = await _folder();
        final file = File('${dir.path}/index.json.tmp');
        await file.writeAsString(
          jsonEncode({
            for (final e in _index!.entries) e.key: e.value.toJson(),
          }),
        );
        await file.rename('${dir.path}/index.json');
      } catch (_) {
        /* Cache persistence is best effort. */
      }
    });
  }

  /// The key for a file on a computer: the computer (its certificate), what it is (a film, a thumbnail) and where.
  static String keyOf(
    String computer,
    String route,
    Map<String, String> query,
  ) {
    final parts = [
      computer,
      route,
      ...(query.keys.toList()..sort()).map((k) => '$k=${query[k]}'),
    ];
    return sha1.convert(utf8.encode(parts.join('\n'))).toString();
  }

  /// What's kept under [key], if anything (and marks it used).
  Future<(CachedMedia, File)?> lookup(String key) => _exclusive(() async {
    final entry = (await _entries())[key];
    if (entry == null) return null;
    final file = File('${(await _folder()).path}/${entry.name}');
    if (!await file.exists() || await file.length() != entry.size) {
      _index!.remove(key);
      _checked.remove(key);
      await file.delete().catchError((_) => File(''));
      _save();
      return null;
    }
    entry.used = DateTime.now().millisecondsSinceEpoch;
    _save();
    return (entry, file);
  });

  /// Whether [key] was checked with the computer recently enough to trust without asking again.
  bool recentlyChecked(String key) {
    final at = _checked[key];
    return at != null && DateTime.now().difference(at) < recheck;
  }

  void markChecked(String key) => _checked[key] = DateTime.now();

  /// Forgets what's kept under [key] (it changed on the computer).
  Future<void> drop(String key) => _exclusive(() async {
    _checked.remove(key);
    final entry = (await _entries()).remove(key);
    if (entry == null) return;
    _save();
    await File(
      '${(await _folder()).path}/${entry.name}',
    ).delete().catchError((_) => File(''));
    _changes.add(null);
  });

  int _serial = 0;
  /// Somewhere to write [key]'s bytes as they arrive; [CacheWriter.commit] keeps them, [CacheWriter.abort] doesn't.
  Future<CacheWriter> write(
    String key,
    String etag,
    String type, {
    int? epoch,
  }) {
    final started = epoch ?? generation;
    return _exclusive(() async {
      await _entries();
      final dir = await _folder();
      final name = '$key-${DateTime.now().microsecondsSinceEpoch}-${_serial++}';
      final part = File('${dir.path}/$name.part');
      return CacheWriter._(
        this,
        key,
        etag,
        type,
        name,
        part,
        part.openWrite(),
        started,
      );
    });
  }

  Future<void> _commit(CacheWriter w, int size) => _exclusive(() async {
    if (w._generation != generation || size > limit) {
      await w._part.delete().catchError((_) => File(''));
      return;
    }
    final dir = await _folder();
    await w._part.rename('${dir.path}/${w._name}');
    final index = await _entries();
    final old = index[w._key];
    index[w._key] = CachedMedia(
      w._name,
      w._etag,
      w._type,
      size,
      DateTime.now().millisecondsSinceEpoch,
    );
    markChecked(w._key);
    if (old != null && old.name != w._name) {
      await File(
        '${dir.path}/${old.name}',
      ).delete().catchError((_) => File(''));
    }
    await _trim();
    _save();
    _changes.add(null);
  });

  /// Least recently used first, until what's kept fits in [limit].
  Future<void> _trim() async {
    final index = await _entries();
    var total = index.values.fold<int>(0, (sum, e) => sum + e.size);
    if (total <= limit) return;
    final dir = await _folder();
    final oldest = index.entries.toList()
      ..sort((a, b) => a.value.used.compareTo(b.value.used));
    for (final e in oldest) {
      if (total <= limit) break;
      index.remove(e.key);
      _checked.remove(e.key);
      total -= e.value.size;
      await File(
        '${dir.path}/${e.value.name}',
      ).delete().catchError((_) => File(''));
    }
  }

  /// Refreshes a picture once at a time per key.
  /// (Not `whenComplete(() => _filling.remove(key))`: that returns this very future, which then waits on itself.)
  Future<void> fill(String key, Future<void> Function() fetch) =>
      _filling[key] ??= fetch().catchError((Object _) {}).whenComplete(() {
        _filling.remove(key);
      });

  /// How much is kept, in bytes.
  Future<int> size() async =>
      (await _entries()).values.fold<int>(0, (sum, e) => sum + e.size);

  /// Lets everything go (the phone left this computer, or the person asked).
  Future<void> clear() {
    generation++;
    return _exclusive(() async {
      await _entries();
      _saving?.cancel();
      _checked.clear();
      _index = {};
      _loading = Future.value(_index!);
      final dir = await _folder();
      if (await dir.exists()) await dir.delete(recursive: true);
      _dir = null;
      _changes.add(null);
    });
  }
}

/// Bytes on their way into the cache.
class CacheWriter {
  final MediaCache _cache;
  final String _key, _etag, _type, _name;
  final File _part;
  final IOSink _sink;
  final int _generation;
  int _written = 0;
  bool _done = false;
  CacheWriter._(
    this._cache,
    this._key,
    this._etag,
    this._type,
    this._name,
    this._part,
    this._sink,
    this._generation,
  ) {
    // A clear can remove an open .part file before the asynchronous sink opens it.
    unawaited(_sink.done.catchError((_) {}));
  }

  void add(List<int> chunk) {
    if (_done) return;
    _written += chunk.length;
    _sink.add(chunk);
  }

  /// Keeps what was written, when it's all there ([expected] bytes, or -1 when the length wasn't said).
  Future<void> commit(int expected) async {
    if (_done) return;
    _done = true;
    try {
      await _sink.close();
      if (expected >= 0 && _written != expected) {
        throw const FormatException('Incomplete cached file');
      }
      await _cache._commit(this, _written);
    } catch (_) {
      await _part.delete().catchError((_) => File(''));
    }
  }

  Future<void> abort() async {
    if (_done) return;
    _done = true;
    await _sink.close().catchError((_) {});
    await _part.delete().catchError((_) => File(''));
  }
}

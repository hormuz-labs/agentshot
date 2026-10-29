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

/// What the phone keeps of the computer's films and pictures, so one already watched plays at once, offline too, and
/// comes over the network again only when it changed there (a new render in its place). Each is checked with the
/// computer by its tag: "not modified" costs a few bytes, not the film.
///
/// Kept in the app's own storage (not a temporary folder the system empties), up to [limit] bytes: past it, what
/// was least recently watched goes. Everything goes when the phone disconnects from the computer.
class MediaCache {
  /// Where the files live; the app's support folder by default (a test's own folder in tests).
  final Future<Directory> Function() _root;

  /// The most it keeps, in bytes.
  int limit;
  MediaCache({Future<Directory> Function()? root, this.limit = 2 << 30})
    : _root = root ?? (() async => Directory('${(await getApplicationSupportDirectory()).path}/media-cache'));

  Directory? _dir;
  Map<String, CachedMedia>? _index;

  /// Checked with the computer lately (key → when): checked again only after [recheck].
  final _checked = <String, DateTime>{};
  static Duration recheck = const Duration(minutes: 2);

  /// Films being fetched whole in the background, so each comes over once.
  final _filling = <String, Future<void>>{};

  /// Says when what's kept changed (for Settings' storage line).
  final _changes = StreamController<void>.broadcast();
  Stream<void> get changes => _changes.stream;

  Future<Directory> _folder() async => _dir ??= await (await _root()).create(recursive: true);

  Future<Map<String, CachedMedia>> _entries() async {
    if (_index case final index?) return index;
    final dir = await _folder();
    final index = <String, CachedMedia>{};
    try {
      final saved = jsonDecode(await File('${dir.path}/index.json').readAsString()) as Map<String, dynamic>;
      for (final MapEntry(:key, :value) in saved.entries) {
        final entry = CachedMedia.fromJson(Map<String, dynamic>.from(value as Map));
        // a file the system or a crash took away isn't kept any more
        if (await File('${dir.path}/${entry.name}').exists()) index[key] = entry;
      }
    } catch (_) {
      // nothing kept yet, or an index that couldn't be read: start over
    }
    return _index ??= index;
  }

  Timer? _saving;
  void _save() {
    _saving?.cancel();
    _saving = Timer(const Duration(milliseconds: 400), () async {
      try {
        final dir = await _folder();
        final file = File('${dir.path}/index.json.tmp');
        await file.writeAsString(jsonEncode({for (final e in (_index ?? {}).entries) e.key: e.value.toJson()}));
        await file.rename('${dir.path}/index.json');
      } catch (_) {
        // the folder went (cleared meanwhile): nothing to remember
      }
    });
  }

  /// The key for a file on a computer: the computer (its certificate), what it is (a film, a thumbnail) and where.
  static String keyOf(String computer, String route, Map<String, String> query) {
    final parts = [computer, route, ...(query.keys.toList()..sort()).map((k) => '$k=${query[k]}')];
    return sha1.convert(utf8.encode(parts.join('\n'))).toString();
  }

  /// What's kept under [key], if anything (and marks it used).
  Future<(CachedMedia, File)?> lookup(String key) async {
    final entry = (await _entries())[key];
    if (entry == null) return null;
    final file = File('${(await _folder()).path}/${entry.name}');
    if (!await file.exists()) {
      _index!.remove(key);
      _save();
      return null;
    }
    entry.used = DateTime.now().millisecondsSinceEpoch;
    _save();
    return (entry, file);
  }

  /// Whether [key] was checked with the computer recently enough to trust without asking again.
  bool recentlyChecked(String key) {
    final at = _checked[key];
    return at != null && DateTime.now().difference(at) < recheck;
  }

  void markChecked(String key) => _checked[key] = DateTime.now();

  /// Forgets what's kept under [key] (it changed on the computer).
  Future<void> drop(String key) async {
    _checked.remove(key);
    final entry = (await _entries()).remove(key);
    if (entry == null) return;
    _save();
    await File('${(await _folder()).path}/${entry.name}').delete().catchError((_) => File(''));
    _changes.add(null);
  }

  /// Somewhere to write [key]'s bytes as they arrive; [CacheWriter.commit] keeps them, [CacheWriter.abort] doesn't.
  Future<CacheWriter> write(String key, String etag, String type) async {
    final dir = await _folder();
    final name = '$key-${DateTime.now().microsecondsSinceEpoch}';
    final part = File('${dir.path}/$name.part');
    return CacheWriter._(this, key, etag, type, name, part, part.openWrite());
  }

  Future<void> _commit(CacheWriter w, int size) async {
    final dir = await _folder();
    await w._part.rename('${dir.path}/${w._name}');
    final index = await _entries();
    final old = index[w._key];
    index[w._key] = CachedMedia(w._name, w._etag, w._type, size, DateTime.now().millisecondsSinceEpoch);
    markChecked(w._key);
    if (old != null && old.name != w._name) {
      await File('${dir.path}/${old.name}').delete().catchError((_) => File(''));
    }
    await _trim();
    _save();
    _changes.add(null);
  }

  /// Least recently used first, until what's kept fits in [limit].
  Future<void> _trim() async {
    final index = await _entries();
    var total = index.values.fold<int>(0, (sum, e) => sum + e.size);
    if (total <= limit) return;
    final dir = await _folder();
    final oldest = index.entries.toList()..sort((a, b) => a.value.used.compareTo(b.value.used));
    for (final e in oldest) {
      if (total <= limit) break;
      index.remove(e.key);
      total -= e.value.size;
      await File('${dir.path}/${e.value.name}').delete().catchError((_) => File(''));
    }
  }

  /// Fetches [key] whole in the background, once at a time per key (a film streamed in parts by the player).
  Future<void> fill(String key, Future<void> Function() fetch) =>
      _filling[key] ??= fetch().whenComplete(() => _filling.remove(key)).catchError((Object _) {});

  /// How much is kept, in bytes.
  Future<int> size() async => (await _entries()).values.fold<int>(0, (sum, e) => sum + e.size);

  /// Lets everything go (the phone left this computer, or the person asked).
  Future<void> clear() async {
    _saving?.cancel();
    _checked.clear();
    _index = {};
    final dir = await _folder();
    if (await dir.exists()) await dir.delete(recursive: true);
    _dir = null;
    _changes.add(null);
  }
}

/// Bytes on their way into the cache.
class CacheWriter {
  final MediaCache _cache;
  final String _key, _etag, _type, _name;
  final File _part;
  final IOSink _sink;
  int _written = 0;
  bool _done = false;
  CacheWriter._(this._cache, this._key, this._etag, this._type, this._name, this._part, this._sink);

  void add(List<int> chunk) {
    if (_done) return;
    _written += chunk.length;
    _sink.add(chunk);
  }

  /// Keeps what was written, when it's all there ([expected] bytes, or -1 when the length wasn't said).
  Future<void> commit(int expected) async {
    if (_done) return;
    _done = true;
    await _sink.close();
    if (expected >= 0 && _written != expected) {
      await _part.delete().catchError((_) => File(''));
      return;
    }
    await _cache._commit(this, _written);
  }

  Future<void> abort() async {
    if (_done) return;
    _done = true;
    await _sink.close().catchError((_) {});
    await _part.delete().catchError((_) => File(''));
  }
}

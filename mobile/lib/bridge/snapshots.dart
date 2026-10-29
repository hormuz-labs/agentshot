import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

/// The last of what the computer said, kept on the phone: the project list, each project and its conversation, the
/// examples. The app opens on them at once (and offline) and the computer's answer replaces them when it comes.
/// One folder per computer; all of it goes when the phone disconnects.
class Snapshots {
  final Future<Directory> Function() _root;
  Snapshots({Future<Directory> Function()? root})
    : _root = root ?? (() async => Directory('${(await getApplicationSupportDirectory()).path}/snapshots'));

  /// The computer they belong to (its certificate fingerprint); nothing is kept without one.
  String? computer;

  final _pending = <String, Object?>{};
  Timer? _flush;

  Future<File?> _file(String name) async {
    final c = computer;
    if (c == null) return null;
    final folder = sha1.convert(utf8.encode(c)).toString().substring(0, 16);
    final file = sha1.convert(utf8.encode(name)).toString();
    return File('${(await _root()).path}/$folder/$file.json');
  }

  /// What was kept under [name], or null.
  Future<Object?> read(String name) async {
    if (_pending.containsKey(name)) return _pending[name];
    try {
      final file = await _file(name);
      if (file == null || !await file.exists()) return null;
      return jsonDecode(await file.readAsString());
    } catch (_) {
      return null;
    }
  }

  /// Keeps [value] under [name] (written a moment later, the latest of a burst only).
  void write(String name, Object? value) {
    if (computer == null) return;
    _pending[name] = value;
    _flush ??= Timer(const Duration(milliseconds: 800), flush);
  }

  Future<void> flush() async {
    _flush?.cancel();
    _flush = null;
    final batch = Map.of(_pending);
    _pending.clear();
    for (final MapEntry(:key, :value) in batch.entries) {
      try {
        final file = await _file(key);
        if (file == null) continue;
        await file.parent.create(recursive: true);
        final part = File('${file.path}.tmp');
        await part.writeAsString(jsonEncode(value));
        await part.rename(file.path);
      } catch (_) {
        // not kept this time; the next change tries again
      }
    }
  }

  /// Forgets everything kept (the phone left the computer).
  Future<void> clear() async {
    _flush?.cancel();
    _flush = null;
    _pending.clear();
    try {
      final root = await _root();
      if (await root.exists()) await root.delete(recursive: true);
    } catch (_) {}
  }
}

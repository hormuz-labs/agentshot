import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'media_cache.dart';

typedef MediaRequest = Future<HttpClientRequest> Function(String method);

class MediaVersionChanged implements Exception {}

class MediaTransferCancelled implements Exception {}

/// Cancellation belongs to one player response, never to another reader of the same file.
class MediaTransfer {
  bool cancelled = false;
  void Function()? abort;
  void cancel() {
    cancelled = true;
    abort?.call();
  }

  void check() {
    if (cancelled) throw MediaTransferCancelled();
  }
}

class MediaDescriptor {
  final String tag, type;
  final int size;
  final bool blocks;
  MediaDescriptor(this.tag, this.type, this.size, this.blocks);
  Map<String, dynamic> toJson() => {
    'tag': tag,
    'type': type,
    'size': size,
    'blocks': blocks,
  };
  factory MediaDescriptor.fromJson(Map<String, dynamic> value) =>
      MediaDescriptor(
        value['tag'] as String,
        value['type'] as String,
        value['size'] as int,
        value['blocks'] == true,
      );
}

/// HTTP ranges use inclusive ends. No allocation or iteration proportional to the full file size.
({int start, int end})? playbackRange(String value, int size) {
  final match = RegExp(r'^bytes=(\d*)-(\d*)$').firstMatch(value.trim());
  if (match == null || size == 0) return null;
  final a = int.tryParse(match[1]!), b = int.tryParse(match[2]!);
  if ((match[1]!.isNotEmpty && a == null) ||
      (match[2]!.isNotEmpty && b == null)) {
    return null;
  }
  if (a == null && (b == null || b == 0)) return null;
  final start = a ?? max(0, size - b!),
      end = a == null ? size - 1 : min(b ?? size - 1, size - 1);
  if (start > end || start >= size) return null;
  return (start: start, end: end);
}

/// A bounded cache of immutable blocks, shared with thumbnails and explicit downloads.
/// No speculative full-film fetch, and no per-file bitmap proportional to video duration.
class MediaRanges {
  static const blockSize = 1024 * 1024;
  static const timeout = Duration(seconds: 20);
  final MediaCache cache;
  MediaRanges(this.cache);
  final _waiting = <Completer<void>>[];
  int _active = 0;
  final _pending = <String, Future<void>>{};

  Future<(CachedMedia, File)?> _cached(String key) async {
    try { return await cache.lookup(key); }
    on FileSystemException { return null; }
  }

  Future<T> _limited<T>(Future<T> Function() run) async {
    if (_active >= 2) {
      if (_waiting.length >= 32) {
        throw const HttpException('Too many playback requests');
      }
      final ready = Completer<void>();
      _waiting.add(ready);
      await ready.future;
    } else {
      _active++;
    }
    try {
      return await run();
    } finally {
      if (_waiting.isNotEmpty) {
        _waiting.removeAt(0).complete();
      } else {
        _active--;
      }
    }
  }

  /// Probe once per player URL. A persisted descriptor permits cached ranges offline.
  /// Authorization failures never use the offline fallback.
  Future<MediaDescriptor> describe(String key, MediaRequest request) =>
      _limited(() async {
        MediaDescriptor? kept;
        final saved = await _cached('descriptor-$key');
        if (saved != null) {
          try {
            kept = MediaDescriptor.fromJson(
              jsonDecode(await saved.$2.readAsString()) as Map<String, dynamic>,
            );
          } catch (_) {}
        }
        HttpClientRequest? req;
        final epoch = cache.generation;
        try {
          req = await request('HEAD').timeout(timeout);
          if (kept != null) req.headers.set('if-none-match', kept.tag);
          final response = await req.close().timeout(timeout);
          await response.drain<void>().timeout(timeout);
          if (response.statusCode == 304 && kept != null) return kept;
          if (response.statusCode != 200) {
            throw StateError(
              'Media metadata request failed (${response.statusCode})',
            );
          }
          final tag = response.headers.value('etag') ?? '';
          final size = response.contentLength;
          if (size < 0) throw const FormatException('Missing media length');
          final result = MediaDescriptor(
            tag,
            response.headers.contentType?.mimeType ??
                'application/octet-stream',
            size,
            response.headers.value('x-agentshot-range-cache') == '1' &&
                tag.startsWith('"') &&
                tag.endsWith('"'),
          );
          if (result.blocks && (kept?.tag != tag || kept?.size != size)) {
            final bytes = utf8.encode(jsonEncode(result.toJson()));
            try {
              final writer = await cache.write(
                'descriptor-$key',
                tag,
                'application/json',
                epoch: epoch,
              );
              writer.add(bytes);
              await writer.commit(bytes.length);
            } on FileSystemException {
              /* Playback works even if the cache is unwritable. */
            }
          }
          return result;
        } on IOException {
          req?.abort();
          if (kept != null) return kept;
          rethrow;
        } on TimeoutException {
          req?.abort();
          if (kept != null) return kept;
          rethrow;
        }
      });

  String _key(String key, MediaDescriptor file, int start) => MediaCache.keyOf(
    key,
    'block-v1',
    {'etag': file.tag, 'size': '${file.size}', 'start': '$start'},
  );

  Future<Uint8List> _block(
    String key,
    MediaDescriptor file,
    int start,
    MediaRequest request,
    MediaTransfer transfer,
  ) async {
    final id = _key(key, file, start);
    // Concurrent readers of the same block wait, then recheck disk. One reader cancelling cannot abort another.
    while (_pending.containsKey(id)) {
      await _pending[id];
      transfer.check();
    }
    final done = Completer<void>();
    _pending[id] = done.future;
    try {
      return await _limited(() async {
        transfer.check();
        final blockKey = _key(key, file, start),
            end = min(start + blockSize, file.size) - 1;
        final length = end - start + 1;
        final kept = await _cached(blockKey);
        if (kept != null && kept.$1.size == length) {
          try {
            final bytes = await kept.$2.readAsBytes();
            if (bytes.length == length) return bytes;
          } on FileSystemException {
            /* evicted meanwhile */
          }
        }
        final epoch = cache.generation;
        final req = await request('GET').timeout(timeout);
        transfer.abort = req.abort;
        try {
          transfer.check();
          req.headers
            ..set('range', 'bytes=$start-$end')
            ..set('if-match', file.tag)
            ..set('x-agentshot-range-cache', '1');
          final response = await req.close().timeout(timeout);
          if (response.statusCode == 412) throw MediaVersionChanged();
          if (response.statusCode != 206 ||
              response.headers.value('etag') != file.tag ||
              response.headers.value('content-range') !=
                  'bytes $start-$end/${file.size}' ||
              response.contentLength != length) {
            throw const FormatException('Invalid media block response');
          }
          final bytes = Uint8List(length);
          var offset = 0;
          await for (final chunk in response.timeout(timeout)) {
            transfer.check();
            if (offset + chunk.length > length) {
              throw const FormatException('Oversized media block');
            }
            bytes.setRange(offset, offset + chunk.length, chunk);
            offset += chunk.length;
          }
          if (offset != length) {
            throw const FormatException('Incomplete media block');
          }
          transfer.check();
          if (epoch == cache.generation) {
            try {
              final writer = await cache.write(
                blockKey,
                file.tag,
                file.type,
                epoch: epoch,
              );
              try {
                writer.add(bytes);
                await writer.commit(length);
              } catch (_) {
                await writer.abort();
              }
            } on FileSystemException {
              /* Cache failure must not interrupt valid playback. */
            }
          }
          return bytes;
        } finally {
          transfer.abort = null;
          req.abort();
        }
      });
    } finally {
      _pending.remove(id);
      done.complete();
    }
  }

  Future<void> serve(
    HttpRequest local,
    String key,
    MediaDescriptor file,
    MediaRequest request,
    MediaTransfer transfer,
  ) async {
    final out = local.response;
    final rangeHeader = local.headers.value('range');
    final range = rangeHeader == null
        ? (start: 0, end: file.size - 1)
        : playbackRange(rangeHeader, file.size);
    if (range == null) {
      out.statusCode = 416;
      out.headers.set('content-range', 'bytes */${file.size}');
      await out.close();
      return;
    }
    out.headers
      ..set('content-type', file.type)
      ..set('accept-ranges', 'bytes')
      ..set('etag', file.tag)
      ..set('cache-control', 'no-store');
    if (rangeHeader != null) {
      out.statusCode = 206;
      out.headers.set(
        'content-range',
        'bytes ${range.start}-${range.end}/${file.size}',
      );
    }
    out.contentLength = max(0, range.end - range.start + 1);
    if (local.method == 'HEAD') {
      await out.close();
      return;
    }
    // Keep one continuous stream so socket cancellation propagates to its producer.
    // Separate add/flush calls can silently discard writes after Dart's HTTP socket has closed.
    var started = false;
    try {
      var start = range.start ~/ blockSize * blockSize;
      if (start <= range.end) {
        // Fail before committing headers if the first block is unavailable.
        var bytes = await _block(key, file, start, request, transfer);
        Stream<List<int>> body() async* {
          try {
            while (true) {
              transfer.check();
              out.deadline = timeout;
              yield Uint8List.sublistView(
                bytes,
                max(0, range.start - start),
                min(bytes.length, range.end - start + 1),
              );
              start += blockSize;
              if (start > range.end) break;
              bytes = await _block(key, file, start, request, transfer);
            }
          } finally {
            transfer.cancel();
          }
        }

        started = true;
        await out.addStream(body());
      }
      await out.close();
      out.deadline = null;
    } catch (_) {
      if (started) {
        // detachSocket cannot be used after headers were sent. Expiring the response
        // destroys this connection, so the player sees an incomplete response.
        out.deadline = Duration.zero;
      } else {
        out.headers.clear();
        out.statusCode = 502;
        out.contentLength = 0;
        await out.close();
      }
    }
  }
}

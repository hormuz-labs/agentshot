import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

const authIssuer = String.fromEnvironment(
  'MANUL_AUTH_ISSUER',
  defaultValue: 'https://clerk.manul.si',
);
const authClientId = String.fromEnvironment(
  'MANUL_AUTH_CLIENT_ID',
  defaultValue: 'cYz60VvV9IL4cGH5',
);
const relayUrl = String.fromEnvironment(
  'MANUL_RELAY',
  defaultValue: 'https://relay.manul.si',
);
const authRedirect = 'si.manul.mobile://oauth/callback';
String randomId([int bytes = 16]) => List.generate(
  bytes,
  (_) => Random.secure().nextInt(256),
).map((n) => n.toRadixString(16).padLeft(2, '0')).join();

class MobileAccount {
  final FlutterSecureStorage storage;
  Map<String, dynamic>? _session;
  Future<String>? _refreshing;
  int _generation = 0;
  static const key = 'manul.account.v1';
  MobileAccount(this.storage);
  bool get signedIn => _session != null;
  String? get email => _session?['email'] as String?;
  String get deviceId => _session!['id'] as String;

  Future<void> restore() async {
    final saved = await storage.read(key: key);
    if (saved != null) {
      try {
        final value = Map<String, dynamic>.from(jsonDecode(saved) as Map);
        if (value['issuer'] == authIssuer &&
            value['client'] == authClientId &&
            value['access'] is String &&
            value['expires'] is int &&
            value['id'] is String) {
          _session = value;
        }
      } catch (_) {
        await storage.delete(key: key);
      }
    }
  }

  Future<Map<String, dynamic>> _json(
    Uri url, {
    Map<String, String>? form,
    String? token,
  }) async {
    if (url.scheme != 'https') {
      throw Exception('Account services require HTTPS');
    }
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await client.openUrl(form == null ? 'GET' : 'POST', url);
      request.followRedirects = false;
      if (token != null) request.headers.set('authorization', 'Bearer $token');
      if (form != null) {
        request.headers.contentType = ContentType(
          'application',
          'x-www-form-urlencoded',
        );
        request.write(Uri(queryParameters: form).query);
      }
      final response = await request.close().timeout(
        const Duration(seconds: 20),
      );
      final body = await utf8.decoder
          .bind(response)
          .join()
          .timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) {
        throw Exception('Sign in to Manul again.');
      }
      return Map<String, dynamic>.from(jsonDecode(body) as Map);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> signIn() async {
    final generation = ++_generation;
    final verifier = randomId(32), state = randomId(24);
    final url = Uri.parse('$authIssuer/oauth/authorize').replace(
      queryParameters: {
        'response_type': 'code',
        'client_id': authClientId,
        'redirect_uri': authRedirect,
        'scope': 'openid email profile offline_access',
        'state': state,
        'code_challenge': base64Url
            .encode(sha256.convert(utf8.encode(verifier)).bytes)
            .replaceAll('=', ''),
        'code_challenge_method': 'S256',
      },
    );
    final result = Uri.parse(
      await FlutterWebAuth2.authenticate(
        url: url.toString(),
        callbackUrlScheme: 'si.manul.mobile',
      ),
    );
    if (result.scheme != 'si.manul.mobile' ||
        result.host != 'oauth' ||
        result.path != '/callback' ||
        result.queryParameters['state'] != state ||
        result.queryParameters['code'] == null ||
        (result.queryParameters['iss'] != null &&
            result.queryParameters['iss'] != authIssuer)) {
      throw Exception('Sign-in did not finish. Try again.');
    }
    final tokens = await _json(
      Uri.parse('$authIssuer/oauth/token'),
      form: {
        'grant_type': 'authorization_code',
        'client_id': authClientId,
        'redirect_uri': authRedirect,
        'code': result.queryParameters['code']!,
        'code_verifier': verifier,
      },
    );
    final who = await _json(
      Uri.parse('$authIssuer/oauth/userinfo'),
      token: tokens['access_token'] as String,
    );
    if (generation != _generation) return;
    await _save({
      'access': tokens['access_token'],
      'refresh': tokens['refresh_token'],
      'expires':
          DateTime.now().millisecondsSinceEpoch +
          ((tokens['expires_in'] as num?)?.toInt() ?? 3600) * 1000,
      'email': who['email'] ?? 'Manul account',
      'id': randomId(),
      'issuer': authIssuer,
      'client': authClientId,
    });
  }

  Future<void> _save(Map<String, dynamic> value) async {
    final generation = _generation;
    await storage.write(key: key, value: jsonEncode(value));
    if (generation != _generation) {
      await storage.delete(key: key);
      throw Exception('Sign-in cancelled.');
    }
    _session = value;
  }

  Future<String> token() async {
    final s = _session;
    if (s == null) throw Exception('Sign in to Manul first.');
    if ((s['expires'] as int) > DateTime.now().millisecondsSinceEpoch + 60000) {
      return s['access'] as String;
    }
    return _refreshing ??= _refresh(s).whenComplete(() => _refreshing = null);
  }

  Future<String> _refresh(Map<String, dynamic> s) async {
    if (s['refresh'] is! String) throw Exception('Sign in to Manul again.');
    final tokens = await _json(
      Uri.parse('$authIssuer/oauth/token'),
      form: {
        'grant_type': 'refresh_token',
        'client_id': authClientId,
        'refresh_token': s['refresh'] as String,
      },
    );
    if (!identical(s, _session)) throw Exception('Sign-in changed.');
    await _save({
      ...s,
      'access': tokens['access_token'],
      'refresh': tokens['refresh_token'] ?? s['refresh'],
      'expires':
          DateTime.now().millisecondsSinceEpoch +
          ((tokens['expires_in'] as num?)?.toInt() ?? 3600) * 1000,
    });
    return tokens['access_token'] as String;
  }

  Future<List<Map<String, dynamic>>> desktops() async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final url = Uri.parse(relayUrl);
      if (url.scheme != 'https') throw Exception('Relay requires HTTPS');
      final request = await client.getUrl(url.replace(path: '/v1/desktops'));
      request.followRedirects = false;
      request.headers.set('authorization', 'Bearer ${await token()}');
      final response = await request.close().timeout(
        const Duration(seconds: 20),
      );
      if (response.statusCode != 200) {
        throw Exception(
          'Cannot reach your computers. Check your sign-in and try again.',
        );
      }
      return (jsonDecode(
                await utf8.decoder
                    .bind(response)
                    .join()
                    .timeout(const Duration(seconds: 20)),
              )
              as List)
          .map((d) => Map<String, dynamic>.from(d as Map))
          .toList();
    } finally {
      client.close(force: true);
    }
  }

  Future<void> signOut() async {
    _generation++;
    _session = null;
    await storage.delete(key: key);
  }
}

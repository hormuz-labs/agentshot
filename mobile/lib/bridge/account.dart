// Signing in on the phone with the AgentShot account people already use on their computer, and then their
// computers: no pairing. Sign-in is Clerk in the browser (OAuth with PKCE, the same public client as the desktop's),
// coming back to the app as agentshot://auth/callback; the account service swaps it for the person's AgentShot key
// (the same key on every device). Every computer signed in to the account reports itself to the account service
// (the desktop's worker heartbeat), which lists them with a token each computer accepts for a day
// (account/src/index.ts, listWorkers). Away from home the phone reaches them through the private network (Mesh).
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'client.dart';
import 'mesh.dart';

/// Production by default; the end-to-end tests point these at stand-ins with --dart-define.
const _issuer = String.fromEnvironment(
  'AUTH_ISSUER',
  defaultValue: 'https://clerk.agentshot.si',
);
const _clientId = String.fromEnvironment(
  'AUTH_CLIENT_ID',
  defaultValue: 'cYz60VvV9IL4cGH5',
);
const _service = String.fromEnvironment(
  'ACCOUNT_URL',
  defaultValue: 'https://account.agentshot.si',
);

/// Where Clerk sends the browser after signing in (registered with Clerk): a page of the account service that hands
/// it straight on into the app as agentshot://auth/callback. Not a server in the app itself: Android freezes an app
/// in the background while the person signs in, so it couldn't answer.
const _redirect = '$_service/oauth/phone';

/// A computer signed in to the person's account that the phone can open.
class Computer {
  final String id;
  final String name;
  final String platform;
  final Connection connection;

  /// A cloud worker this person leases (AgentShot lends it; it keeps only what they make there).
  final bool pool;
  Computer(
    this.id,
    this.name,
    this.platform,
    this.connection, {
    this.pool = false,
  });

  factory Computer.fromJson(Json json) {
    final urls = (json['urls'] as List? ?? const [])
        .whereType<String>()
        .toList();
    final c = Connection.fromJson({
      'url': urls.first,
      'urls': urls,
      'fingerprint': json['fingerprint'],
      'token': json['token'],
      'machine': json['id'],
      'name': json['name'],
    });
    return Computer(
      json['id'] as String,
      json['name'] as String? ?? 'Computer',
      '${object(json['capabilities'] ?? {})['platform'] ?? ''}',
      c,
      pool: json['pool'] == true,
    );
  }
}

class Account {
  static const _storageKey = 'agentshot.account.v1';
  final FlutterSecureStorage storage;

  /// Opens [url] in the browser and returns the agentshot://auth/callback… address it came back to.
  final Future<String> Function(String url) browser;
  String? key, keyId, email;

  /// The cloud worker this phone leased, if any: given back on switching away or signing out.
  String? leased;

  /// Cloud workers free to lease, as of the last look at the person's computers.
  int poolFree = 0;
  Account({
    this.storage = const FlutterSecureStorage(),
    Future<String> Function(String url)? browser,
  }) : browser = browser ?? _openBrowser;

  static Future<String> _openBrowser(String url) =>
      FlutterWebAuth2.authenticate(url: url, callbackUrlScheme: 'agentshot');

  bool get signedIn => key != null;

  Future<void> restore() async {
    try {
      final saved = await storage.read(key: _storageKey);
      if (saved == null) return;
      final data = object(jsonDecode(saved));
      key = data['key'] as String?;
      keyId = data['keyId'] as String?;
      email = data['email'] as String?;
      leased = data['leased'] as String?;
    } catch (_) {
      await storage.delete(key: _storageKey);
    }
  }

  /// Signs in through the browser and keeps the AgentShot key on this device.
  Future<void> signIn() async {
    String b64(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');
    final random = Random.secure();
    final verifier = b64(List.generate(32, (_) => random.nextInt(256)));
    final state = b64(List.generate(16, (_) => random.nextInt(256)));
    final authorize = Uri.parse('$_issuer/oauth/authorize').replace(
      queryParameters: {
        'response_type': 'code',
        'client_id': _clientId,
        'redirect_uri': _redirect,
        'scope': 'openid email profile',
        'state': state,
        'code_challenge': b64(sha256.convert(ascii.encode(verifier)).bytes),
        'code_challenge_method': 'S256',
      },
    );
    final String back;
    try {
      back = await browser(authorize.toString());
    } catch (_) {
      throw BridgeException('Signing in was cancelled.');
    }
    final answer = Uri.parse(back).queryParameters;
    final code = answer['code'];
    if (answer['state'] != state || code == null) {
      throw BridgeException('Signing in didn’t finish. Try again.');
    }

    final token = await _send(
      'POST',
      Uri.parse('$_issuer/oauth/token'),
      form: {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': _redirect,
        'client_id': _clientId,
        'code_verifier': verifier,
      },
      failure: 'Signing in didn’t finish. Try again.',
    );
    final access = token['access_token'] as String?;
    if (access == null) {
      throw BridgeException('Signing in didn’t finish. Try again.');
    }
    final got = await _send(
      'POST',
      Uri.parse('$_service/v1/key'),
      bearer: access,
      failure: 'Could not sign in to AgentShot. Try again in a moment.',
    );
    key = got['key'] as String?;
    keyId = got['key_id'] as String?;
    email = got['email'] as String?;
    if (key == null) {
      throw BridgeException(
        'Could not sign in to AgentShot. Try again in a moment.',
      );
    }
    await _save();
  }

  Future<void> _save() => storage.write(
    key: _storageKey,
    value: jsonEncode({
      'key': key,
      'keyId': keyId,
      'email': email,
      'leased': ?leased,
    }),
  );

  Future<void> signOut() async {
    await release();
    key = keyId = email = null;
    await storage.delete(key: _storageKey);
  }

  /// Credits left and the plan ({credits, plan: {name}?, …}).
  Future<Json> balance() => _asKey('GET', '/v1/balance');

  /// The person's computers that are on and signed in to AgentShot now, and a cloud worker they lease.
  Future<List<Computer>> computers() async {
    final data = await _asKey('GET', '/v1/workers');
    poolFree = (data['poolAvailable'] as num?)?.toInt() ?? 0;
    return objects(data['workers'])
        .where((w) => (w['urls'] as List?)?.isNotEmpty == true)
        .map(Computer.fromJson)
        .toList();
  }

  /// Leases a cloud worker: for when none of the person's computers is on.
  Future<Computer> lease() async {
    final Json got;
    try {
      got = await _asKey('POST', '/v1/workers/lease', body: {});
    } on BridgeException catch (e) {
      if (e.status == 404) {
        throw BridgeException(
          'No cloud workers are free right now. Try again in a moment.',
          404,
        );
      }
      rethrow;
    }
    final worker = Computer.fromJson(object(got['worker']));
    leased = worker.id;
    await _save();
    return worker;
  }

  /// Gives the leased cloud worker back, if there is one.
  Future<void> release() async {
    final id = leased;
    if (id == null) return;
    leased = null;
    await _save();
    try {
      await _asKey('POST', '/v1/workers/release', body: {'workerId': id});
    } catch (_) {
      // it lapses by itself within the hour
    }
  }

  /// A fresh connection for [expired]'s computer, if it is still on.
  Future<Connection?> renew(Connection expired) async {
    if (!signedIn) return null;
    for (final c in await computers()) {
      if (c.id == expired.machine) return c.connection;
    }
    return null;
  }

  /// Opens [computer]: through the private network when it isn't on this Wi-Fi.
  Future<void> connect(
    BridgeClient client,
    Computer computer, {
    void Function()? away,
  }) async {
    final target = computer.connection;
    // at home: every address at once, the first to answer wins (about a second)
    var first = await client.firstToAnswer(target);
    // away: only then the private network, which takes longer to join
    if (first == null &&
        target.urls.any((u) => Mesh.isMeshHost(u.host)) &&
        Mesh.proxyPort == null) {
      away?.call();
      try {
        final join = await _asKey(
          'POST',
          '/v1/mesh/join',
          body: {'role': 'client', 'persistent': true},
        );
        await Mesh.start(
          join['controlUrl'] as String,
          join['authKey'] as String,
        );
        await client.rememberMesh(join['controlUrl'] as String);
        first = await client.firstToAnswer(
          target,
          timeout: const Duration(seconds: 15),
        );
      } catch (_) {
        // no private network here (iOS for now, or the account service has none)
      }
    }
    if (first == null) {
      throw BridgeException(
        'Could not reach ${computer.name}. Make sure AgentShot is open on it, then try again.',
      );
    }
    // the address that answered first, the others after it for reconnecting later
    await client.connectDirect(
      Connection(
        first,
        target.fingerprint,
        target.token,
        target.urls,
        target.machine,
        target.name,
      ),
    );
  }

  Future<Json> _asKey(String method, String path, {Json? body}) async {
    if (!signedIn) throw BridgeException('Sign in first.');
    try {
      return await _send(
        method,
        Uri.parse('$_service$path'),
        bearer: key,
        headers: {'x-manul-key-id': ?keyId},
        json: body,
        failure:
            'Could not reach AgentShot. Check your connection and try again.',
      );
    } on BridgeException catch (e) {
      if (e.status == 401) {
        await signOut();
        throw BridgeException('Your sign-in has expired. Sign in again.', 401);
      }
      rethrow;
    }
  }

  static Future<Json> _send(
    String method,
    Uri uri, {
    String? bearer,
    Map<String, String> headers = const {},
    Map<String, String>? form,
    Json? json,
    required String failure,
  }) async {
    final http = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await http.openUrl(method, uri);
      if (bearer != null) {
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      }
      headers.forEach(req.headers.set);
      if (form != null) {
        req.headers.contentType = ContentType(
          'application',
          'x-www-form-urlencoded',
        );
        req.write(Uri(queryParameters: form).query);
      } else if (json != null) {
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(json));
      }
      final res = await req.close().timeout(const Duration(seconds: 30));
      final text = await utf8.decoder.bind(res).join();
      Json data = {};
      try {
        data = object(jsonDecode(text));
      } catch (_) {}
      if (res.statusCode >= 400) {
        throw BridgeException(
          data['error'] as String? ?? failure,
          res.statusCode,
        );
      }
      return data;
    } on BridgeException {
      rethrow;
    } catch (_) {
      throw BridgeException(failure);
    } finally {
      http.close();
    }
  }
}

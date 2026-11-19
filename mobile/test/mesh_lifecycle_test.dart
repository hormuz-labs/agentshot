import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/mesh.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('agentshot/native');
  final calls = <String>[];
  setUp(() {
    calls.clear();
    Mesh.proxyPort = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      if (call.method == 'meshStart') return '{"ip":"100.64.0.2","proxyPort":12345}';
      return null;
    });
  });
  tearDown(() {
    Mesh.proxyPort = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });
  test('both platforms use the same native mesh lifecycle and network refresh', () async {
    await Mesh.networkChanged();
    expect(calls, isEmpty);
    await Mesh.start('https://mesh.agentshot.si', 'key');
    expect(Mesh.proxyPort, 12345);
    await Mesh.networkChanged();
    await Mesh.stop();
    expect(Mesh.proxyPort, isNull);
    expect(calls, ['meshStart', 'meshNetworkChanged', 'meshStop']);
  });
  test('native refresh failure does not abort reconnection', () async {
    Mesh.proxyPort = 12345;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (_) async {
      throw PlatformException(code: 'mesh', message: 'offline');
    });
    await Mesh.networkChanged();
    expect(Mesh.proxyPort, 12345);
  });
}

import 'package:agentshot_mobile/bridge/device_label.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('androidLabel', () {
    test('puts the maker in front of a model name that lacks it', () {
      expect(
        androidLabel(
          manufacturer: 'samsung',
          model: 'SM-S911B',
          name: 'Galaxy S23',
        ),
        'Samsung Galaxy S23',
      );
    });
    test('keeps a name that already says the maker', () {
      expect(
        androidLabel(
          manufacturer: 'Google',
          model: 'Pixel 8',
          name: 'Google Pixel 8',
        ),
        'Google Pixel 8',
      );
      expect(
        androidLabel(manufacturer: 'OnePlus', model: 'OnePlus 12'),
        'OnePlus 12',
      );
    });
    test('keeps a name someone gave the phone as it is', () {
      expect(
        androidLabel(
          manufacturer: 'samsung',
          model: 'SM-S911B',
          name: "Asha's phone",
        ),
        "Asha's phone",
      );
    });
    test('falls back to the maker and model, then to a plain name', () {
      expect(
        androidLabel(manufacturer: 'Xiaomi', model: 'Redmi Note 13'),
        'Xiaomi Redmi Note 13',
      );
      expect(androidLabel(manufacturer: 'xiaomi', model: ''), 'Xiaomi phone');
      expect(androidLabel(manufacturer: '', model: ''), 'Android phone');
    });
  });
  group('iosLabel', () {
    test('uses the model name, then the model, then iPhone', () {
      expect(
        iosLabel(modelName: 'iPhone 16 Pro', model: 'iPhone'),
        'iPhone 16 Pro',
      );
      expect(iosLabel(model: 'iPad'), 'iPad');
      expect(iosLabel(), 'iPhone');
    });
  });
  test('installId is made once and then kept', () async {
    FlutterSecureStorage.setMockInitialValues({});
    const storage = FlutterSecureStorage();
    final first = await installId(storage);
    expect(first, matches(RegExp(r'^[A-Za-z0-9]{32}$')));
    expect(await installId(storage), first);
  });
}

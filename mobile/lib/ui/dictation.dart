import 'dart:async';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// The phone's own speech recognition (Android's, Apple's), for voice notes: the words come as they're said, without
/// the computer. Behind an interface so the tests can stand in for it, or say there's none ([Dictation.override]).
abstract class Dictation {
  /// The tests' dictation, when set.
  static Dictation Function()? override;
  static Dictation create() => override?.call() ?? _PhoneDictation();

  /// Whether this phone recognizes speech, with the microphone allowed. False sends voice notes to the computer.
  Future<bool> available();

  /// Starts listening; [words] gets everything said so far, as it's recognized.
  Future<bool> start(void Function(String words) words);

  /// How loud it is, 0 (silence) to 1, while listening.
  Stream<double> get level;

  /// Stops listening: all that was said.
  Future<String> stop();
  Future<void> cancel();
  void dispose();
}

/// A phone with none (or none allowed): voice notes go to the computer.
class NoDictation implements Dictation {
  @override
  Future<bool> available() async => false;
  @override
  Future<bool> start(void Function(String words) words) async => false;
  @override
  Stream<double> get level => const Stream.empty();
  @override
  Future<String> stop() async => '';
  @override
  Future<void> cancel() async {}
  @override
  void dispose() {}
}

class _PhoneDictation implements Dictation {
  // one recognizer for the app, as the plugin wants
  static final _speech = SpeechToText();
  static bool? _ready;

  final _levels = StreamController<double>.broadcast();
  void Function(String)? _words;

  /// What earlier stretches heard: the recognizer stops after a pause, and is started again while the mic is held.
  String _kept = '', _now = '';
  bool _holding = false;
  Completer<void>? _ended;
  double _low = 0, _high = 1;

  String get _said =>
      [_kept, _now].where((s) => s.trim().isNotEmpty).join(' ').trim();

  @override
  Future<bool> available() async {
    try {
      return _ready ??= await _speech.initialize(
        onStatus: _status,
        onError: (_) => _status(SpeechToText.doneStatus),
      );
    } catch (_) {
      return _ready = false; // no recognizer here (or no plugin, in tests)
    }
  }

  void _status(String status) {
    final ended =
        status == SpeechToText.doneStatus ||
        status == SpeechToText.notListeningStatus;
    if (!ended) return;
    if (_holding) {
      // a pause ended this stretch while the mic is still held: keep its words, listen again
      _kept = _said;
      _now = '';
      unawaited(_listen());
    } else if (_ended != null && !_ended!.isCompleted) {
      _ended!.complete();
    }
  }

  Future<void> _listen() => _speech.listen(
    onResult: _result,
    onSoundLevelChange: _level,
    listenOptions: SpeechListenOptions(
      partialResults: true,
      listenMode: ListenMode.dictation,
      cancelOnError: false,
      autoPunctuation: true,
      pauseFor: const Duration(seconds: 30),
      listenFor: const Duration(minutes: 15),
    ),
  );

  void _result(SpeechRecognitionResult r) {
    _now = r.recognizedWords;
    _words?.call(_said);
  }

  // the level's range differs by phone (Android about -2 to 10 dB, iPhone about -50 to 0): scaled to what's heard
  void _level(double db) {
    if (_levels.isClosed) return;
    _low = db < _low ? db : _low;
    _high = db > _high ? db : _high;
    _levels.add(((db - _low) / (_high - _low)).clamp(0.0, 1.0));
  }

  @override
  Future<bool> start(void Function(String words) words) async {
    if (!await available()) return false;
    // the one recognizer reports to this note
    _speech.statusListener = _status;
    _speech.errorListener = (_) => _status(SpeechToText.doneStatus);
    _words = words;
    _kept = _now = '';
    _holding = true;
    try {
      await _listen();
      return true;
    } catch (_) {
      _holding = false;
      return false;
    }
  }

  @override
  Stream<double> get level => _levels.stream;

  @override
  Future<String> stop() async {
    _holding = false;
    _ended = Completer<void>();
    await _speech.stop();
    // the last words come with the end; never wait long for them
    await _ended!.future.timeout(const Duration(seconds: 3), onTimeout: () {});
    return _said;
  }

  @override
  Future<void> cancel() async {
    _holding = false;
    await _speech.cancel();
  }

  @override
  void dispose() {
    _holding = false;
    _words = null;
    _levels.close();
  }
}

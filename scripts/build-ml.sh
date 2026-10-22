#!/bin/sh
# Build Manul's model runners for this machine into resources/bin/<platform>-<arch>/:
#   manul-speakers   who speaks when (scripts/ml/manul-speakers.c on sherpa-onnx's speaker diarization)
#   manul-vision     faces and objects in video frames (scripts/ml/manul-vision.c on onnxruntime)
# and on Linux the agent's fence, manul-fence (scripts/ml/manul-fence.c, Landlock; macOS uses its built-in sandbox).
# Both link sherpa-onnx's static release libraries (onnxruntime included) — one self-contained binary each.
# Every download is SHA-256 checked. The models they run come from scripts/fetch-models.mjs. Needs curl + a C/C++ compiler.
set -e
SHERPA=1.13.8
ORT=1.28.2 # the onnxruntime inside that sherpa-onnx release
VERSION=2-$SHERPA # 2: --embed
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 PKG=osx-arm64 SHA=9091bf160dc7fdacedbc906b212badf53c2993f4e5277a0e03998e96c31d60da ;;
  Darwin-x86_64) TARGET=darwin-x64 PKG=osx-x64 SHA=a3f88da3e54c850a12d61431e73f8affcd1f13738b75b768847dd79541835b4b ;;
  Linux-x86_64) TARGET=linux-x64 PKG=linux-x64 SHA=e1fdc5b67530e15741ef897fa5ffff297056f3bf0c6d829a27af9225a4c4b5a6 ;;
  Linux-aarch64) TARGET=linux-arm64 PKG=linux-aarch64 SHA=77983e3cf29aa60f2e531d249dbd01d15596530550c8db2e9e02fc6a655da6bb ;;
  *) echo "unsupported platform"; exit 1 ;;
esac
OUT=resources/bin/$TARGET
fresh() { [ -x "$OUT/$1" ] && [ "$(cat "$OUT/.$1.version" 2>/dev/null)" = "$VERSION" ] && [ "$OUT/$1" -nt "scripts/ml/$1.c" ]; }
fence_ok() { [ "$(uname -s)" != Linux ] || { [ -x "$OUT/manul-fence" ] && [ "$OUT/manul-fence" -nt scripts/ml/manul-fence.c ]; }; }
if fresh manul-speakers && fresh manul-vision && fence_ok; then echo "manul-speakers and manul-vision $VERSION already built"; exit 0; fi

WORK=${TMPDIR:-/tmp}/manul-ml-$SHERPA-$TARGET
mkdir -p "$WORK/inc/sherpa-onnx/c-api"
get() { # url, file, sha256
  if [ ! -f "$2" ] || [ "$(shasum -a 256 "$2" | cut -c1-64)" != "$3" ]; then
    curl -sSfL -o "$2.part" "$1"
    got=$(shasum -a 256 "$2.part" | cut -c1-64)
    [ "$got" = "$3" ] || { rm -f "$2.part"; echo "$1: checksum mismatch (got $got); refusing to use it"; exit 1; }
    mv "$2.part" "$2"
  fi
}
LIBS=sherpa-onnx-v$SHERPA-$PKG-static-lib
get "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA/$LIBS.tar.bz2" "$WORK/$LIBS.tar.bz2" $SHA
[ -d "$WORK/$LIBS/lib" ] || tar -xjf "$WORK/$LIBS.tar.bz2" -C "$WORK"
get "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v$SHERPA/sherpa-onnx/c-api/c-api.h" "$WORK/inc/sherpa-onnx/c-api/c-api.h" 2a1b95084be8fd1deb3228fcad2fd3f7f0258b64582f7402281ec174c7b7f4ce
H=https://raw.githubusercontent.com/microsoft/onnxruntime/v$ORT/include/onnxruntime/core/session
get $H/onnxruntime_c_api.h "$WORK/inc/onnxruntime_c_api.h" b69a133143c0da61782b2b02cc8a620d21ac139231fd211719776d10385135c1
get $H/onnxruntime_error_code.h "$WORK/inc/onnxruntime_error_code.h" 5ce3b054e798eced8d14f5b86e98692fd33470463f96194ce0700a2d53dd8721
get $H/onnxruntime_ep_c_api.h "$WORK/inc/onnxruntime_ep_c_api.h" db86df0f846b8d3bdbf429a5c76c5805293196575ca3c475878612591cd18e51

L="$WORK/$LIBS/lib"
SHERPA_LIBS="-lsherpa-onnx-c-api -lsherpa-onnx-core -lkaldi-native-fbank-core -lkissfft-float -lsherpa-onnx-kaldifst-core -lsherpa-onnx-fstfar -lsherpa-onnx-fst -lkaldi-decoder-core -lssentencepiece_core -lpiper_phonemize -lespeak-ng -lucd -lonnxruntime"
if [ "$(uname -s)" = Darwin ]; then
  SYS="-framework Foundation -mmacosx-version-min=12.0"
  GROUP_START="" GROUP_END=""
else
  SYS="-static-libstdc++ -static-libgcc -lpthread -ldl -lm"
  GROUP_START="-Wl,--start-group" GROUP_END="-Wl,--end-group"
fi
mkdir -p "$OUT"
# shellcheck disable=SC2086 # the library lists are split on purpose
c++ -O2 -x c scripts/ml/manul-speakers.c -I"$WORK/inc" -L"$L" $GROUP_START $SHERPA_LIBS $GROUP_END $SYS -o "$OUT/manul-speakers"
# shellcheck disable=SC2086
c++ -O2 -x c scripts/ml/manul-vision.c -I"$WORK/inc" -L"$L" $GROUP_START -lonnxruntime $GROUP_END $SYS -o "$OUT/manul-vision"
for b in manul-speakers manul-vision; do
  strip "$OUT/$b" 2>/dev/null || true
  echo "$VERSION" > "$OUT/.$b.version"
done
if [ "$(uname -s)" = Linux ]; then
  cc -O2 -Wall -o "$OUT/manul-fence" scripts/ml/manul-fence.c
  strip "$OUT/manul-fence" 2>/dev/null || true
fi
echo "built $OUT/manul-speakers and $OUT/manul-vision ($VERSION)"

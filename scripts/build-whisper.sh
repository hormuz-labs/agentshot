#!/bin/sh
# Build AgentShot's bundled whisper.cpp (whisper-cli) for this machine into resources/bin/<platform>-<arch>/.
# Static (no dylibs), portable (no -march=native); on macOS the Metal GPU code is embedded in the binary.
# Needs cmake + a C/C++ compiler. CI runs this per target; models are downloaded on demand, never bundled.
set -e
VERSION=v1.9.4
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 ;; Darwin-x86_64) TARGET=darwin-x64 ;;
  Linux-x86_64) TARGET=linux-x64 ;; Linux-aarch64) TARGET=linux-arm64 ;;
  *) echo "unsupported platform"; exit 1 ;;
esac
OUT=resources/bin/$TARGET
if [ -x "$OUT/whisper-cli" ] && [ "$(cat "$OUT/.whisper-cli.version" 2>/dev/null)" = "$VERSION" ]; then echo "whisper-cli $VERSION already built"; exit 0; fi
SRC=${TMPDIR:-/tmp}/agentshot-whisper-$VERSION
[ -d "$SRC" ] || git clone --depth 1 --branch $VERSION https://github.com/ggml-org/whisper.cpp "$SRC"
FLAGS="-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF"
if [ "$(uname -s)" = Darwin ]; then FLAGS="$FLAGS -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0"; fi
# shellcheck disable=SC2086 # FLAGS is a list of -D options, split on purpose
cmake -S "$SRC" -B "$SRC/build" $FLAGS
cmake --build "$SRC/build" --target whisper-cli -j 8
mkdir -p "$OUT"
cp "$SRC/build/bin/whisper-cli" "$OUT/whisper-cli"
strip "$OUT/whisper-cli" 2>/dev/null || true
echo "$VERSION" > "$OUT/.whisper-cli.version"
echo "built $OUT/whisper-cli ($VERSION)"

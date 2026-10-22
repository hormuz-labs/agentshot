#!/bin/sh
# Build manul-beats (scripts/beats/manul-beats.c on aubio: tempo, beats, onsets and energy of music) for this machine
# into resources/bin/<platform>-<arch>/. aubio's sources are compiled straight into the one static binary with a fixed
# config: no optional libraries (it reads WAV; Manul's ffmpeg decodes everything else), the same built-in FFT on every
# platform so beats come out the same everywhere. Needs git + a C compiler. CI runs this per target.
set -e
AUBIO=ad5cf975aed08cc4562dd008cf9f83b12b82ffb8 # github.com/aubio/aubio master, April 2026 (0.5.0 in progress)
VERSION=1-$AUBIO
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 ;; Darwin-x86_64) TARGET=darwin-x64 ;;
  Linux-x86_64) TARGET=linux-x64 ;; Linux-aarch64) TARGET=linux-arm64 ;;
  *) echo "unsupported platform"; exit 1 ;;
esac
OUT=resources/bin/$TARGET
if [ -x "$OUT/manul-beats" ] && [ "$(cat "$OUT/.manul-beats.version" 2>/dev/null)" = "$VERSION" ] && \
   [ "$OUT/manul-beats" -nt scripts/beats/manul-beats.c ]; then echo "manul-beats $VERSION already built"; exit 0; fi
SRC=${TMPDIR:-/tmp}/manul-aubio-$AUBIO
if [ ! -d "$SRC/src" ]; then
  rm -rf "$SRC"
  git init -q "$SRC"
  git -C "$SRC" fetch -q --depth 1 https://github.com/aubio/aubio $AUBIO
  git -C "$SRC" checkout -q FETCH_HEAD
fi
# the headers aubio's code includes as <aubio/…>
mkdir -p "$SRC/build/include"
ln -sfn "$SRC/src" "$SRC/build/include/aubio"
cat > "$SRC/build/config.h" <<'EOF'
#define HAVE_STDLIB_H 1
#define HAVE_STDIO_H 1
#define HAVE_MATH_H 1
#define HAVE_STRING_H 1
#define HAVE_ERRNO_H 1
#define HAVE_LIMITS_H 1
#define HAVE_STDARG_H 1
#define HAVE_C99_VARARGS_MACROS 1
#define HAVE_WAVREAD 1
#define HAVE_WAVWRITE 1
EOF
FILES=$(find "$SRC/src" -name '*.c' | sort)
mkdir -p "$OUT"
# shellcheck disable=SC2086 # FILES is a list of paths without spaces, split on purpose
cc -O2 -std=c99 -DHAVE_CONFIG_H -I"$SRC/build" -I"$SRC/src" -I"$SRC/build/include" -w $FILES scripts/beats/manul-beats.c \
  -lm $( [ "$(uname -s)" = Darwin ] && echo "-mmacosx-version-min=12.0" ) -o "$OUT/manul-beats"
strip "$OUT/manul-beats" 2>/dev/null || true
echo "$VERSION" > "$OUT/.manul-beats.version"
echo "built $OUT/manul-beats ($VERSION)"

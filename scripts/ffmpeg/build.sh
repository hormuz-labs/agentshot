#!/bin/sh
# Build Manul's ffmpeg + ffprobe for this machine: Martin Riedl's build script (the same configuration the
# downloaded builds had: x264, x265, libass, VideoToolbox…) plus the libraries Manul's analysis and editing need
# that those builds lack:
#   vid.stab     vidstabdetect / vidstabtransform (measure and remove camera shake)
#   Rubber Band  rubberband (speed changes without pitch change)
# Static; on macOS for 12.0+. Output: dist/ffmpeg/<target>/ffmpeg.zip and ffprobe.zip, the files
# scripts/fetch-ffmpeg.mjs downloads from the GitHub release and pins by SHA-256 (.github/workflows/ffmpeg.yml).
#   scripts/ffmpeg/build.sh            build for this machine
#   scripts/ffmpeg/build.sh --install  also put the binaries in resources/bin/<target>/ to try them locally
# Needs: a C/C++ compiler, rust + cargo-c, python3 with virtualenv (or meson), curl, zip. About 30–60 minutes.
set -e
FFMPEG=9.0.2
SCRIPT_COMMIT=f63b8aab8f5ce1a067da86ba69e34a36a7e217e5 # git.martin-riedl.de/ffmpeg/build-script (main)
VIDSTAB=1.1.2
RUBBERBAND=4.0.0

cd "$(dirname "$0")/../.."
REPO=$(pwd)
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 ;; Darwin-x86_64) TARGET=darwin-x64 ;;
  Linux-x86_64) TARGET=linux-x64 ;; Linux-aarch64) TARGET=linux-arm64 ;;
  *) echo "unsupported platform"; exit 1 ;;
esac
WORK=${MANUL_FFMPEG_WORK:-${TMPDIR:-/tmp}/manul-ffmpeg-$FFMPEG-$TARGET}
OUT=$REPO/dist/ffmpeg/$TARGET
[ "$(uname -s)" = Darwin ] && export MACOSX_DEPLOYMENT_TARGET=12.0

# the build script at a fixed commit, with Manul's modules and versions added
rm -rf "$WORK"
mkdir -p "$WORK"
# its downloads (plain curl) retry a few times: a moment's DNS or network failure shouldn't end an hour-long build
printf 'retry = 5\nretry-delay = 10\nretry-all-errors\n' > "$WORK/.curlrc"
export CURL_HOME=$WORK
git -C "$WORK" init -q script
git -C "$WORK/script" fetch -q --depth 1 https://git.martin-riedl.de/ffmpeg/build-script.git $SCRIPT_COMMIT
git -C "$WORK/script" checkout -q FETCH_HEAD
S=$WORK/script
cp scripts/ffmpeg/build-vidstab.sh scripts/ffmpeg/build-rubberband.sh "$S/script/"
chmod +x "$S/script/build-vidstab.sh" "$S/script/build-rubberband.sh"
printf %s "$FFMPEG" > "$S/version/ffmpeg"
printf %s "$VIDSTAB" > "$S/version/vidstab"
printf %s "$RUBBERBAND" > "$S/version/rubberband"

# libvorbis 1.3.7's configure passes -force_cpusubtype_ALL to the linker on macOS, which Xcode 15+'s linker rejects
# (Homebrew strips it the same way)
grep -q '^./configure --prefix="$TOOL_DIR" --enable-shared=no$' "$S/script/build-libvorbis.sh" || { echo "build-libvorbis.sh changed: check the -force_cpusubtype_ALL fix"; exit 1; }
awk '/^.\/configure --prefix="\$TOOL_DIR" --enable-shared=no$/ { print "sed -i.orig \"s/-force_cpusubtype_ALL//g\" configure" } { print }' \
  "$S/script/build-libvorbis.sh" > "$S/script/build-libvorbis.sh.new" && mv "$S/script/build-libvorbis.sh.new" "$S/script/build-libvorbis.sh"
chmod +x "$S/script/build-libvorbis.sh"

# code.videolan.org answers archive downloads with a bot check now. x264: the same repository over git, at a fixed
# commit (the script took whatever master was); dav1d: the release tarball from VideoLAN's download server.
X264=0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee
swap() { # file, exact line, replacement line
  grep -qxF "$2" "$S/script/$1" || { echo "$1 changed: no line '$2' to replace"; exit 1; }
  awk -v old="$2" -v new="$3" '$0 == old { print new; next } { print }' "$S/script/$1" > "$S/script/$1.new"
  mv "$S/script/$1.new" "$S/script/$1"; chmod +x "$S/script/$1"
}
swap build-x264.sh 'download https://code.videolan.org/videolan/x264/-/archive/master/x264-master.tar.gz "x264-master.tar.gz"' \
  "git init -q x264-master && git -C x264-master fetch -q --depth 1 https://code.videolan.org/videolan/x264.git $X264 && git -C x264-master checkout -q FETCH_HEAD && tar -czf x264-master.tar.gz x264-master && rm -rf x264-master"
swap build-dav1d.sh 'download https://code.videolan.org/videolan/dav1d/-/archive/$VERSION/dav1d-$VERSION.tar.gz "dav1d.tar.gz"' \
  'download https://downloads.videolan.org/pub/videolan/dav1d/$VERSION/dav1d-$VERSION.tar.xz "dav1d.tar.xz" && tar -xJf dav1d.tar.xz && tar -czf dav1d.tar.gz dav1d-$VERSION && rm -rf dav1d-$VERSION'

# old autotools tarballs (zvbi, libtheora…) ship a config.guess from before Linux on arm64 ("cannot guess build type"):
# on Linux, refresh config.guess/config.sub from the installed automake before every ./configure
if [ "$(uname -s)" = Linux ]; then
  cat >> "$S/script/functions.sh" <<'EOF'

refreshConfigGuess(){
    for f in config.guess config.sub; do
        [ -f "$f" ] || continue
        new=$(ls /usr/share/automake-*/"$f" /usr/share/misc/"$f" 2>/dev/null | tail -1)
        [ -n "$new" ] && cp "$new" "$f" && echo "refreshed $f from $new"
    done
}
EOF
  for m in "$S"/script/build-*.sh; do
    awk '/^\.\/configure/ { print "refreshConfigGuess" } { print }' "$m" > "$m.new" && mv "$m.new" "$m" && chmod +x "$m"
  done
fi

# say whose build it is in `ffmpeg -version`
swap build-ffmpeg.sh 'EXTRA_VERSION="https://www.martin-riedl.de"' 'EXTRA_VERSION="manul"'

# build.sh decides the GPL flags right after the last library: add ours just before that
grep -q '^# check other ffmpeg flags$' "$S/build.sh" || { echo "build.sh changed: no '# check other ffmpeg flags' line to insert Manul's libraries before"; exit 1; }
awk '
/^# check other ffmpeg flags$/ {
  for (n = split("vidstab rubberband", lib, " "); i < n;) {
    l = lib[++i]
    print "START_TIME=$(currentTimeInSeconds)"
    print "echoSection \"compile " l " (Manul)\""
    print "$SCRIPT_DIR/build-" l ".sh \"$SCRIPT_DIR\" \"$SOURCE_DIR\" \"$TOOL_DIR\" \"$CPUS\" > \"$LOG_DIR/build-" l ".log\" 2>&1"
    print "checkStatus $? \"build " l "\""
    print "echoDurationInSections $START_TIME"
    print "FFMPEG_LIB_FLAGS=\"$FFMPEG_LIB_FLAGS --enable-lib" l "\""
    print "REQUIRES_GPL=\"YES\""
    print ""
  }
}
{ print }' "$S/build.sh" > "$S/build.manul.sh"
chmod +x "$S/build.manul.sh"

# Only what the build makes may end up in the binary: hide Homebrew/MacPorts libraries (an openjpeg tool once linked
# Homebrew's lcms2 and broke). CMake ignores those prefixes; on macOS PATH holds just the system, cargo and autotools.
cat > "$WORK/hermetic.cmake" <<'EOF'
set(CMAKE_IGNORE_PREFIX_PATH /opt/homebrew /usr/local /opt/local)
set(CMAKE_SYSTEM_IGNORE_PREFIX_PATH /opt/homebrew /usr/local /opt/local)
EOF
export CMAKE_TOOLCHAIN_FILE="$WORK/hermetic.cmake"
if [ "$(uname -s)" = Darwin ] && [ -n "$(ls -A /usr/local/include 2>/dev/null)" ] && [ -z "$MANUL_FFMPEG_ALLOW_USR_LOCAL" ]; then
  # Apple's clang always searches /usr/local/include and /usr/local/lib (Homebrew's home on Intel Macs): a library found
  # there gets half-linked into the build (fontconfig picked up Homebrew's gettext and failed to link)
  echo "/usr/local/include isn't empty: the compiler would pick up those libraries. Move /usr/local/include and"
  echo "/usr/local/lib aside while building (Homebrew's programs keep working), or set MANUL_FFMPEG_ALLOW_USR_LOCAL=1."
  exit 1
fi
if [ "$(uname -s)" = Darwin ]; then
  mkdir -p "$WORK/hostbin"
  for t in autoconf autoheader autom4te autoreconf autoscan autoupdate ifnames aclocal automake glibtoolize glibtool; do
    p=$(command -v $t) || { echo "missing $t (brew install autoconf automake libtool)"; exit 1; }
    ln -sf "$p" "$WORK/hostbin/$t"
  done
  ln -sf "$(command -v glibtoolize)" "$WORK/hostbin/libtoolize"
  CARGO_BIN=$(dirname "$(command -v cargo)")
  PY_USER_BIN=$(/usr/bin/python3 -c 'import site; print(site.USER_BASE)')/bin # the python3 this PATH finds
  export PATH="$WORK/hostbin:$CARGO_BIN:$PY_USER_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
fi

mkdir -p "$WORK/compile"
cd "$WORK/compile"
if ! "$S/build.manul.sh" -SKIP_BUNDLE=YES -SKIP_TEST=YES; then
  echo "--- build failed; last lines of each log:"
  for f in log/build-*.log; do echo "== $f"; tail -15 "$f"; done
  exit 1
fi
BIN=$WORK/compile/out/bin

# what Manul relies on is really there, and nothing links to libraries a user's machine won't have
for f in vidstabdetect vidstabtransform rubberband drawtext subtitles scdet signalstats blackdetect freezedetect ebur128 loudnorm; do
  "$BIN/ffmpeg" -hide_banner -filters 2>/dev/null | grep -q " $f " || { echo "ffmpeg is missing the $f filter"; exit 1; }
done
for enc in libx264 aac; do
  "$BIN/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -q " $enc " || { echo "ffmpeg is missing the $enc encoder"; exit 1; }
done
if [ "$(uname -s)" = Darwin ]; then
  otool -L "$BIN/ffmpeg" | tail -n +2 | grep -vE '^[[:space:]]*(/usr/lib/|/System/Library/)' && { echo "ffmpeg links non-system libraries (above)"; exit 1; }
else
  ldd "$BIN/ffmpeg" | grep -vE 'linux-vdso|ld-linux|lib(c|m|mvec|dl|pthread|rt|stdc\+\+|gcc_s)\.so' | grep '=>' && { echo "ffmpeg links non-system libraries (above)"; exit 1; }
fi

rm -rf "$OUT"
mkdir -p "$OUT"
for tool in ffmpeg ffprobe; do
  strip "$BIN/$tool" 2>/dev/null || true
  (cd "$BIN" && zip -q -X -9 "$OUT/$tool.zip" "$tool")
done
"$BIN/ffmpeg" -hide_banner -buildconf > "$OUT/buildconf.txt"
echo "built $OUT ($(cd "$OUT" && shasum -a 256 ffmpeg.zip ffprobe.zip | tr '\n' ' '))"

if [ "$1" = --install ]; then
  mkdir -p "$REPO/resources/bin/$TARGET"
  cp "$BIN/ffmpeg" "$BIN/ffprobe" "$REPO/resources/bin/$TARGET/"
  rm -f "$REPO/resources/bin/$TARGET/.ffmpeg.sha256" "$REPO/resources/bin/$TARGET/.ffprobe.sha256" # npm install fetches the pinned build again
  echo "installed into resources/bin/$TARGET"
fi

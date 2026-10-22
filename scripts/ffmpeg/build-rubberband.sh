#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 (modelled on Martin Riedl's build modules; see LICENSES/Apache-2.0.txt)
# Rubber Band (librubberband) for FFmpeg's rubberband filter: changing speed without changing pitch (speed ramps,
# slow motion with sound, fitting music to a length) far cleaner than atempo.
# A module for Martin Riedl's build script (same arguments and layout as its script/build-*.sh); build.sh copies it in.
# GPL-2.0-or-later; FFmpeg needs --enable-gpl for it.

# handle arguments
echo "arguments: $@"
SCRIPT_DIR=$1
SOURCE_DIR=$2
TOOL_DIR=$3
CPUS=$4

# load functions
. $SCRIPT_DIR/functions.sh

# load version
VERSION=$(cat "$SCRIPT_DIR/../version/rubberband")
checkStatus $? "load version failed"
echo "version: $VERSION"

# start in working directory
cd "$SOURCE_DIR"
checkStatus $? "change directory failed"
mkdir "rubberband"
checkStatus $? "create directory failed"
cd "rubberband/"
checkStatus $? "change directory failed"

# download source
download https://breakfastquay.com/files/releases/rubberband-$VERSION.tar.bz2 "rubberband.tar.bz2"
checkStatus $? "download failed"

# unpack
tar -xjf "rubberband.tar.bz2"
checkStatus $? "unpack failed"

# prepare python3 virtual environment / meson
prepareMeson

# prepare build
# built-in FFT and resampler: no FFTW / libsamplerate to build and link; no plugins, JNI or command-line tool.
cd "rubberband-$VERSION/"
checkStatus $? "change directory failed"
# 4.0.0 uses size_t without including <cstddef>; newer libc++/libstdc++ headers no longer bring it in by accident
export CXXFLAGS="${CXXFLAGS:-} -include cstddef"
meson setup build --prefix "$TOOL_DIR" --libdir=lib --buildtype=release --default-library=static \
    -Dfft=builtin -Dresampler=builtin -Djni=disabled -Dladspa=disabled -Dlv2=disabled -Dvamp=disabled \
    -Dcmdline=disabled -Dtests=disabled
checkStatus $? "configuration failed"

# build
ninja -v -j $CPUS -C build
checkStatus $? "build failed"

# install
ninja -v -C build install
checkStatus $? "installation failed"

# post-installation
# it is C++: a static link into ffmpeg (C) needs the C++ runtime named
if [ "$(uname -s)" = "Darwin" ]; then CXXLIB="-lc++"; else CXXLIB="-lstdc++"; fi
sed -i.original -e "s/-lrubberband/-lrubberband $CXXLIB -lm/" "$TOOL_DIR/lib/pkgconfig/rubberband.pc"
checkStatus $? "modify pkg-config failed"

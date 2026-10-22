#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 (modelled on Martin Riedl's build modules; see LICENSES/Apache-2.0.txt)
# vid.stab (libvidstab) for FFmpeg's vidstabdetect / vidstabtransform filters: measuring and removing camera shake.
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
VERSION=$(cat "$SCRIPT_DIR/../version/vidstab")
checkStatus $? "load version failed"
echo "version: $VERSION"

# start in working directory
cd "$SOURCE_DIR"
checkStatus $? "change directory failed"
mkdir "vidstab"
checkStatus $? "create directory failed"
cd "vidstab/"
checkStatus $? "change directory failed"

# download source
download https://github.com/georgmartius/vid.stab/archive/refs/tags/v$VERSION.tar.gz "vidstab.tar.gz"
checkStatus $? "download failed"

# unpack
tar -zxf "vidstab.tar.gz"
checkStatus $? "unpack failed"
cd "vid.stab-$VERSION/"
checkStatus $? "change directory failed"

# prepare build
# no OpenMP: Apple's clang has none, and a static libgomp would have to be linked into ffmpeg as well.
# SSE2 only on x86 (its CMake test passes on arm64 compilers that then reject the intrinsics).
case "$(uname -m)" in
    x86_64|amd64) SSE2=ON ;;
    *) SSE2=OFF ;;
esac
cmake -S . -B build -G Ninja -DCMAKE_INSTALL_PREFIX:PATH="$TOOL_DIR" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF -DUSE_OMP=OFF -DSSE2_FOUND=$SSE2 -DCMAKE_POSITION_INDEPENDENT_CODE=ON
checkStatus $? "configuration failed"

# build
ninja -v -j $CPUS -C build
checkStatus $? "build failed"

# install
ninja -v -C build install
checkStatus $? "installation failed"

# post-installation
# static linking needs libm listed after the library
sed -i.original -e 's/-lvidstab/-lvidstab -lm/' "$TOOL_DIR/lib/pkgconfig/vidstab.pc"
checkStatus $? "modify pkg-config failed"

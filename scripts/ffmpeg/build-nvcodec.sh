#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 (modelled on Martin Riedl's build modules; see LICENSES/Apache-2.0.txt)
# nv-codec-headers for FFmpeg's NVENC encoders: headers only. FFmpeg opens the NVIDIA driver when an encoder is used, so
# the binary links nothing new and still runs on machines without one. MIT.
# A module for Martin Riedl's build script (same arguments and layout as its script/build-*.sh); build.sh copies it in.

# handle arguments
echo "arguments: $@"
SCRIPT_DIR=$1
SOURCE_DIR=$2
TOOL_DIR=$3
CPUS=$4

# load functions
. $SCRIPT_DIR/functions.sh

# load version
VERSION=$(cat "$SCRIPT_DIR/../version/nvcodec")
checkStatus $? "load version failed"
echo "version: $VERSION"

# start in working directory
cd "$SOURCE_DIR"
checkStatus $? "change directory failed"
mkdir "nvcodec"
checkStatus $? "create directory failed"
cd "nvcodec/"
checkStatus $? "change directory failed"

# download source
download https://github.com/FFmpeg/nv-codec-headers/archive/refs/tags/n$VERSION.tar.gz "nvcodec.tar.gz"
checkStatus $? "download failed"

# unpack
tar -xzf "nvcodec.tar.gz"
checkStatus $? "unpack failed"
cd "nv-codec-headers-n$VERSION/"
checkStatus $? "change directory failed"

# install (a Makefile that only copies the headers and a .pc file)
make PREFIX="$TOOL_DIR" install
checkStatus $? "install failed"

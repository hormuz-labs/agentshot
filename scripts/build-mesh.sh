#!/bin/sh
# Build the embedded Headscale/Tailscale (tsnet) mesh node from scripts/mesh (Go).
#   desktop (default): agentshot-mesh for this machine into resources/bin/<platform>-<arch>/
#   android:           mobile/android/app/libs/agentshotmesh.aar via gomobile (needs the Android SDK + NDK)
# tailscale.com is pinned in scripts/mesh/go.mod at the client version the Headscale server supports.
set -e
cd "$(dirname "$0")/.."
case "${1:-desktop}" in
  desktop)
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) TARGET=darwin-arm64 ;; Darwin-x86_64) TARGET=darwin-x64 ;;
      Linux-x86_64) TARGET=linux-x64 ;; Linux-aarch64) TARGET=linux-arm64 ;;
      *) echo "unsupported platform"; exit 1 ;;
    esac
    mkdir -p "resources/bin/$TARGET"
    (cd scripts/mesh && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "../../resources/bin/$TARGET/agentshot-mesh" .)
    echo "built resources/bin/$TARGET/agentshot-mesh"
    ;;
  android)
    export PATH="$PATH:$(go env GOPATH)/bin"
    # gomobile/gobind at the golang.org/x/mobile version pinned in scripts/mesh/go.mod
    (cd scripts/mesh && go install golang.org/x/mobile/cmd/gomobile golang.org/x/mobile/cmd/gobind)
    : "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
    : "${ANDROID_NDK_HOME:=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort | tail -1)}"
    export ANDROID_HOME ANDROID_NDK_HOME
    mkdir -p mobile/android/app/libs
    (cd scripts/mesh && gomobile bind -target=android/arm64,android/amd64 -androidapi 24 -trimpath -ldflags='-s -w' \
      -javapkg si.agentshot.mesh -o ../../mobile/android/app/libs/agentshotmesh.aar ./mobile)
    rm -f mobile/android/app/libs/agentshotmesh-sources.jar
    echo "built mobile/android/app/libs/agentshotmesh.aar"
    ;;
  *) echo "usage: $0 [desktop|android]"; exit 1 ;;
esac

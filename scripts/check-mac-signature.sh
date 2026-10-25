#!/bin/sh
# Fails unless every packaged AgentShot.app under <dist> is Developer ID signed (bundled tools included), notarized with
# the ticket stapled, and accepted by Gatekeeper, i.e. a downloaded copy opens without "can't be opened" or "damaged".
#   scripts/check-mac-signature.sh dist
set -eu
dist=${1:-dist}
found=0
for app in "$dist"/mac*/AgentShot.app; do
  [ -d "$app" ] || continue
  found=1
  echo "== $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dvv "$app" 2>&1 | grep -q '^Authority=Developer ID Application:' || { echo "not signed with a Developer ID Application certificate"; exit 1; }
  # every bundled executable and library (ffmpeg, whisper, agentshot-mesh, python…) needs the hardened runtime for notarization
  find "$app/Contents/Resources" -type f -perm -u+x -o -type f \( -name '*.dylib' -o -name '*.so' -o -name '*.node' \) | while read -r f; do
    kind=$(file -b "$f")
    case $kind in *Mach-O*) ;; *) continue ;; esac
    info=$(codesign -dvv "$f" 2>&1) || { echo "unsigned: $f"; exit 1; }
    echo "$info" | grep -q 'Authority=Developer ID Application:' || { echo "not Developer ID signed: $f"; exit 1; }
    case $kind in *executable*) echo "$info" | grep -q 'flags=.*runtime' ;; esac || { echo "no hardened runtime: $f"; exit 1; }
  done
  # validating asks Apple (CloudKit), whose connection drops now and then on CI: a few tries before giving up
  tries=0
  until xcrun stapler validate "$app"; do
    tries=$((tries + 1))
    [ "$tries" -lt 5 ] || { echo "the stapled ticket did not validate"; exit 1; }
    echo "stapler validate failed; trying again in 15 s ($tries/5)"
    sleep 15
  done
  spctl --assess --type execute --verbose=2 "$app" 2>&1 | tee /dev/stderr | grep -q 'source=Notarized Developer ID' || { echo "Gatekeeper does not accept it as notarized"; exit 1; }
done
[ "$found" = 1 ] || { echo "no AgentShot.app under $dist"; exit 1; }

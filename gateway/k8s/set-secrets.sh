#!/bin/sh
# Put the production keys from gateway/.env into manul-secrets (see gateway/.env.example). Only those keys, and only
# non-empty, non-placeholder values, are written; every other key in the secret stays as it is. Values are never
# printed. Restarts the pods unless --no-restart.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
env_file="$here/../.env"
[ -f "$env_file" ] || { echo "No gateway/.env: copy gateway/.env.example to gateway/.env and fill it in."; exit 1; }
kubectl -n manul get secret manul-secrets >/dev/null
patch=$(python3 - "$env_file" <<'PY'
import json, re, sys
PRODUCTION = {'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AZURE_ENDPOINT', 'AZURE_API_KEY',
              'CLERK_SECRET_KEY'}   # Dodo and the wallet come from Pitch's secret: link-pitch.sh
PLACEHOLDER = re.compile(r'^(<.*>|…|\.\.\.|fake|test|dummy|change-?me|x+)$', re.I)
data = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k, v = line.split('=', 1)
    k, v = k.strip().removeprefix('export '), v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in (chr(34), chr(39)): v = v[1:-1]  # "quoted" or 'quoted'
    if k in PRODUCTION and v and not PLACEHOLDER.match(v): data[k] = v
print(json.dumps({"stringData": data}) if data else '')
PY
)
[ -n "$patch" ] || { echo "Nothing to change: no production key in gateway/.env has a value."; exit 0; }
printf '%s' "$patch" | kubectl -n manul patch secret manul-secrets --type merge --patch-file /dev/stdin >/dev/null
echo "Saved: $(printf '%s' "$patch" | python3 -c 'import json,sys; print(", ".join(sorted(json.load(sys.stdin)["stringData"])))')"
[ "${1:-}" = "--no-restart" ] && exit 0
kubectl -n manul rollout restart deploy/bifrost deploy/account
kubectl -n manul rollout status deploy/bifrost --timeout=180s
kubectl -n manul rollout status deploy/account --timeout=120s

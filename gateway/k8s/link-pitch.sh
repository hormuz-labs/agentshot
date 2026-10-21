#!/bin/sh
# Points Manul's accounts at Pitch's billing: copies, from Pitch's secret pitch-runtime (namespace pitch) into
# manul-secrets, the wallet's database (Pitch's DATABASE_URL, without Prisma's options), the Dodo Payments key and the
# plans' live products, and its PostHog project (account events go where Pitch's do). Values are never printed. Run again whenever Pitch's change; restarts the account service.
set -eu
src=$(kubectl -n pitch get secret pitch-runtime -o json)
patch=$(printf '%s' "$src" | python3 -c '
import base64, json, sys
d = {k: base64.b64decode(v).decode() for k, v in json.load(sys.stdin)["data"].items()}
out = {"WALLET_DATABASE_URL": d["DATABASE_URL"].split("?")[0], "DODO_API_KEY": d["DODO_PAYMENTS_API_KEY"]}
if d.get("VITE_POSTHOG_KEY"): out["POSTHOG_KEY"] = d["VITE_POSTHOG_KEY"]
if d.get("VITE_POSTHOG_HOST"): out["POSTHOG_HOST"] = d["VITE_POSTHOG_HOST"]
for k in ("PRO", "MAX", "PRO_ANNUAL", "MAX_ANNUAL", "FLEX"):
    v = d.get(f"DODO_PRODUCT_{k}_LIVE")
    if v: out[f"DODO_PRODUCT_{k}_LIVE"] = v
print(json.dumps({"stringData": out}))')
printf '%s' "$patch" | kubectl -n manul patch secret manul-secrets --type merge --patch-file /dev/stdin >/dev/null
echo "Linked: $(printf '%s' "$patch" | python3 -c 'import json,sys; print(", ".join(sorted(json.load(sys.stdin)["stringData"])))')"
[ "${1:-}" = "--no-restart" ] && exit 0
kubectl -n manul rollout restart deploy/account
kubectl -n manul rollout status deploy/account --timeout=120s

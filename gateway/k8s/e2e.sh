#!/bin/sh
# Production smoke test for accounts and the wallet (scripts/account-e2e.mjs), in a throwaway pod next to the account
# service, with its secrets. It cleans up after itself; the pod is removed when it ends.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
npx --prefix "$root" esbuild "$root/scripts/account-e2e.mjs" --bundle --platform=node --format=esm --target=node24 --outfile="$root/out/account/e2e.mjs" \
  --banner:js="import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" --log-level=warning
kubectl -n manul create configmap account-e2e --from-file=e2e.mjs="$root/out/account/e2e.mjs" --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f - >/dev/null
kubectl -n manul delete pod account-e2e --ignore-not-found >/dev/null
kubectl -n manul run account-e2e --restart=Never --image=node:24.11.1-alpine --overrides='{"spec":{"nodeSelector":{"pool":"system"},"containers":[{"name":"e2e","image":"node:24.11.1-alpine","command":["node","/e2e/e2e.mjs"],"envFrom":[{"secretRef":{"name":"manul-secrets"}}],"env":[{"name":"BIFROST_URL","value":"http://bifrost:8080"},{"name":"BIFROST_PROVIDERS","value":"anthropic,gemini,openai,azure"}],"volumeMounts":[{"name":"e2e","mountPath":"/e2e"}]}],"volumes":[{"name":"e2e","configMap":{"name":"account-e2e"}}]}}' >/dev/null
kubectl -n manul wait --for=jsonpath='{.status.phase}'=Succeeded pod/account-e2e --timeout=300s >/dev/null 2>&1 || true
kubectl -n manul logs account-e2e
phase=$(kubectl -n manul get pod account-e2e -o jsonpath='{.status.phase}')
kubectl -n manul delete pod account-e2e >/dev/null
[ "$phase" = Succeeded ]

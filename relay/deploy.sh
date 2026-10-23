#!/bin/sh
# Deploy only the relay, preserving other live ingress routes.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
expected=gke_gen-lang-client-0717491123_asia-southeast1-b_silverfish
[ "$(kubectl config current-context)" = "$expected" ] || { echo 'Select the silverfish kubectl context first.' >&2; exit 1; }
npx esbuild relay/start.ts --bundle --platform=node --format=esm --packages=bundle --external:bufferutil --external:utf-8-validate --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" --outfile=out/relay/relay.mjs
kubectl -n manul create configmap relay-code --from-file=relay.mjs=out/relay/relay.mjs --dry-run=client -o yaml | kubectl apply --server-side --field-manager=manul-relay -f -
kubectl apply -f relay/k8s.yaml
kubectl -n manul get ingress manul -o json | node relay/ingress-patch.mjs | kubectl -n manul patch ingress manul --type=json --patch-file=/dev/stdin
kubectl -n manul rollout restart deployment/relay
kubectl -n manul rollout status deployment/relay --timeout=180s

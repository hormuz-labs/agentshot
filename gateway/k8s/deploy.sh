#!/bin/sh
# Deploy Manul's gateway and account service to the current kubectl context (see gateway/README.md → Production).
# The secrets (manul-secrets) are created once by hand; the production keys in gateway/.env, if present, are written into it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)

gcloud compute addresses describe manul-gateway --global >/dev/null 2>&1 || gcloud compute addresses create manul-gateway --global
kubectl create namespace manul --dry-run=client -o yaml | kubectl apply -f -
kubectl -n manul create configmap bifrost-config --from-file=config.json="$here/config.json" --dry-run=client -o yaml | kubectl apply -f -
npm --prefix "$root" run account:build
kubectl -n manul create configmap account-code --from-file=server.mjs="$root/out/account/server.mjs" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n manul create configmap manul-media --from-file=media.json="$here/media.json" --dry-run=client -o yaml | kubectl apply -f -
kubectl get secret manul-secrets -n manul >/dev/null || { echo "Create the manul-secrets secret first (gateway/README.md)."; exit 1; }
# production keys from gateway/.env, if there is one (the restart below picks them up)
[ -f "$here/../.env" ] && "$here/set-secrets.sh" --no-restart
kubectl apply -f "$here/manul.yaml"
# pick up changed config or code
kubectl -n manul rollout restart deployment/bifrost deployment/account
kubectl -n manul rollout status deployment/bifrost --timeout=180s
kubectl -n manul rollout status deployment/account --timeout=120s
echo "Gateway IP: $(gcloud compute addresses describe manul-gateway --global --format='value(address)')"

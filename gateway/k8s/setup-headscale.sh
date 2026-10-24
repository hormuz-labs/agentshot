#!/bin/sh
# Idempotent setup and verification for Headscale and worker pool secrets in the manul namespace.
# Can be run standalone (`./gateway/k8s/setup-headscale.sh`) or as part of `deploy.sh`.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

# 1. Remove any legacy relay resources from the cluster
kubectl -n manul delete deployment/relay service/relay configmap/relay-code backendconfig.cloud.google.com/relay managedcertificate.networking.gke.io/manul-relay --ignore-not-found >/dev/null 2>&1 || true

# 2. Wait for Headscale deployment to be ready
kubectl -n manul rollout status deployment/headscale --timeout=120s

# 3. Ensure the 'manul' mesh user exists in Headscale
kubectl -n manul exec deploy/headscale -- headscale users create manul >/dev/null 2>&1 || true

# 4. Ensure WORKER_POOL_SECRET exists in manul-secrets
pool_secret=$(kubectl -n manul get secret manul-secrets -o jsonpath='{.data.WORKER_POOL_SECRET}' 2>/dev/null | base64 -d 2>/dev/null || true)
secret_changed=0
if [ -z "$pool_secret" ]; then
  pool_secret=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\r\n')
  kubectl -n manul patch secret manul-secrets --type merge -p "{\"stringData\":{\"WORKER_POOL_SECRET\":\"$pool_secret\"}}" >/dev/null
  secret_changed=1
fi

# 5. Verify existing HEADSCALE_API_KEY against Headscale; mint a fresh key if missing or invalid
hs_key=$(kubectl -n manul get secret manul-secrets -o jsonpath='{.data.HEADSCALE_API_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)
key_valid=0
if [ -n "$hs_key" ]; then
  if kubectl -n manul exec deploy/account -- node -e "
    fetch('http://headscale:8080/api/v1/user', { headers: { authorization: 'Bearer $hs_key' } })
      .then(r => process.exit(r.ok ? 0 : 1))
      .catch(() => process.exit(1));
  " >/dev/null 2>&1; then
    key_valid=1
  fi
fi

if [ "$key_valid" -eq 0 ]; then
  hs_key=$(kubectl -n manul exec deploy/headscale -- headscale apikeys create --expiration 3650d | tail -n 1 | tr -d '\r\n')
  if [ -z "$hs_key" ]; then
    echo "Failed to create Headscale API key." >&2
    exit 1
  fi
  kubectl -n manul patch secret manul-secrets --type merge -p "{\"stringData\":{\"HEADSCALE_API_KEY\":\"$hs_key\"}}" >/dev/null
  secret_changed=1
fi

if [ "$secret_changed" -eq 1 ]; then
  kubectl -n manul rollout restart deployment/account
  kubectl -n manul rollout status deployment/account --timeout=120s
fi

# 6. Smoke check /v1/mesh/join from account service
kubectl -n manul exec deploy/account -- node --input-type=module -e '
const r = await fetch("http://127.0.0.1:8080/v1/mesh/join", {
  method: "POST",
  headers: { "x-manul-pool-secret": process.env.WORKER_POOL_SECRET, "content-type": "application/json" },
  body: "{}"
});
const out = await r.json().catch(() => ({}));
if (!r.ok || !out.authKey) {
  console.error("Headscale mesh smoke check failed:", r.status, out);
  process.exit(1);
}
console.log("Headscale mesh ready:", out.controlUrl, out.tag);
'

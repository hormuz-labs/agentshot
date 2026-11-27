#!/usr/bin/env bash
# Deploy chat-host (AgentShot in Claude and ChatGPT on the web) to the current kubectl context. First time: set up
# Clerk, DNS and the secrets as chat-host/README.md says, and point mcp.agentshot.si at the chat-host service.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
node "$root/scripts/build-chat-host.mjs"
kubectl -n manul create configmap chat-host-code --from-file=server.mjs="$root/out/chat-host/server.mjs" --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -
kubectl -n manul create configmap chat-host-page --from-file=editor.html="$root/out/chat-host/editor.html" --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -
kubectl apply -f "$root/gateway/k8s/chat-host.yaml"
kubectl -n manul rollout restart deployment/chat-host
kubectl -n manul rollout status deployment/chat-host --timeout=180s

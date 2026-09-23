#!/bin/sh
set -eu
# Allow only explicitly configured outbound hosts; no filesystem/process grants.
# Modules were cached at build time; frozen/cached-only prevents runtime fetches.
exec deno run --config services/whatsapp-ingress/deno.json --frozen --cached-only \
  --allow-env --allow-net="${INGRESS_ALLOWED_NET:-0.0.0.0:8080}" \
  services/whatsapp-ingress/main.ts

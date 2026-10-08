#!/usr/bin/env bash
# Valida migration 20271108000100 + scripts/backfill-media-file-name.sql num
# Postgres 15 DESCARTÁVEL (Docker). Nunca aponta para banco remoto.
#
#   bash scripts/test-media-file-name/run.sh            (da raiz do repo)
#
# Cobre: apply + reapply (idempotência), função de extração (payload nulo,
# tipo errado, gigante, bidi, controle ASCII), trigger BEFORE INSERT, script
# de backfill (2 rodadas, plano via idx_whatsapp_messages_direction, armadilha
# de trigger de UPDATE) e rollback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Git Bash no Windows: o Docker precisa do caminho Windows.
command -v cygpath >/dev/null 2>&1 && ROOT="$(cygpath -w "$ROOT")"
NAME="pg-media-file-name-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

MSYS_NO_PATHCONV=1 docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x \
  -v "$ROOT:/w:ro" postgres:15 >/dev/null
for _ in $(seq 1 40); do
  docker exec "$NAME" psql -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

MSYS_NO_PATHCONV=1 docker exec "$NAME" bash /w/scripts/test-media-file-name/inner.sh

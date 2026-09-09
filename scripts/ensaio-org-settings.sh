#!/usr/bin/env bash
# scripts/ensaio-org-settings.sh — ensaio transacional da RPC set_org_settings
# contra PRODUÇÃO. Molde: scripts/ensaio-scrum641.sh (mesmas guardas mecânicas).
#
# BEGIN / antes (função ausente + organizations sem policy de UPDATE não-master)
#   / 20271002000000 (ARQUIVO DE VERDADE)
#   / depois (admin pode · membro não · chave intrusa recusada · cross-org
#             recusado · faixa validada · anon fora · tabela fechada)
#   / ROLLBACK. Nada é aplicado.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20271002000000_org_ajusta_o_que_e_dela.sql"
ANTES="$ROOT/scripts/ensaio-org-settings.sql"
DEPOIS="$ROOT/scripts/ensaio-org-settings-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-org-settings.montado.sql}"
for f in "$ANTES" "$MIG" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done
cat "$ANTES" "$MIG" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────
# Um COMMIT esquecido no meio APLICA em produção o que deveria ser só ensaio.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }
SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
grep -q "CONCURRENTLY" "$OUT" && { echo "RECUSADO: CONCURRENTLY nao roda em transacao" >&2; exit 1; }
grep -q "ENSAIO_OK org-settings" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
[[ $MONTAR == 1 ]] && { echo "==> --montar: nada executado."; exit 0; }
node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"

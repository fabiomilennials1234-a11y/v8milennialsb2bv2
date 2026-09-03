#!/usr/bin/env bash
# scripts/ensaio-647-fatia2.sh — ensaio transacional da FATIA 2 da SCRUM-647
# (as leitoras das views de compat passam a ler `negocio_projetado`), contra
# PRODUCAO. Molde: scripts/ensaio-funis-fatia-b.sh.
#
#   ensaio-647-fatia2-antes.sql   (BEGIN + captura 'antes')
#     / 20270919000020_leitoras_pela_projecao_canonica.sql   (15 funcoes)
#     / 20270919000030_dashboard_metrics_pela_projecao.sql   (1 funcao)
#     / ensaio-647-fatia2-depois.sql (captura 'depois' + PROVA B + ENSAIO_OK
#                                     que ABORTA)
#   / ROLLBACK. NADA e aplicado.
#
# Uso:
#   scripts/ensaio-647-fatia2.sh --montar   # so monta e imprime o caminho
#   scripts/ensaio-647-fatia2.sh            # roda contra producao
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG1="$ROOT/supabase/migrations/20270919000020_leitoras_pela_projecao_canonica.sql"
MIG2="$ROOT/supabase/migrations/20270919000030_dashboard_metrics_pela_projecao.sql"
ANTES="$ROOT/scripts/ensaio-647-fatia2-antes.sql"
DEPOIS="$ROOT/scripts/ensaio-647-fatia2-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-647-fatia2.montado.sql}"

for f in "$ANTES" "$MIG1" "$MIG2" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ANTES" "$MIG1" "$MIG2" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECANICAS ──────────────────────────────────────────────────────
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
if grep -q "CONCURRENTLY" "$OUT"; then echo "RECUSADO: CONCURRENTLY nao roda em transacao" >&2; exit 1; fi
grep -q "ENSAIO_OK SCRUM-647-FATIA2" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

# ─── GUARDA DE SIMETRIA: as duas capturas tem de ser O MESMO TEXTO ──────────
# O bloco vai do CREATE das sondas ate a ultima chamada. Se "antes" e "depois"
# nao forem o mesmo texto a menos do rotulo da fase, a
# igualdade pode sair de uma assimetria de captura em vez de sair dos dados —
# que e exatamente o falso verde que este ensaio existe para nao produzir.
bloco() { sed -n '/^CREATE OR REPLACE FUNCTION pg_temp\._e647_org(/,/^SELECT pg_temp\._e647_grants(/p' "$1" | sed "s/'$2'/'FASE'/g"; }
H_ANTES="$(bloco "$ANTES" antes | shasum | cut -d' ' -f1)"
H_DEPOIS="$(bloco "$DEPOIS" depois | shasum | cut -d' ' -f1)"
LINHAS="$(bloco "$ANTES" antes | grep -c . || true)"
echo "==> bloco de captura: ${LINHAS} linhas, sha ${H_ANTES:0:12}"
[[ "$LINHAS" -gt 50 ]] || { echo "RECUSADO: bloco de captura tem ${LINHAS} linhas — nao foi lido" >&2; exit 1; }
[[ "$H_ANTES" == "$H_DEPOIS" ]] || { echo "RECUSADO: captura 'antes' e 'depois' divergem no TEXTO" >&2; exit 1; }

# ─── GUARDA DE ESCOPO: o ensaio nao pode escrever em prod ───────────────────
# `pipeline_entries`, `leads`, `pipelines`: se alguma linha do payload escrever
# nelas fora da transacao de ensaio, o ROLLBACK ainda salva — mas o ensaio
# passa a exercitar caminho de escrita que ninguem pediu. Aqui so as migrations
# podem conter DDL, e DDL so de funcao.
DDL_FORA="$(grep -icE '^[[:space:]]*(DROP|TRUNCATE|ALTER TABLE)' <<<"$SEM_COMENTARIO" || true)"
[[ "$DDL_FORA" == "0" ]] || { echo "RECUSADO: payload contem DROP/TRUNCATE/ALTER TABLE (${DDL_FORA})" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> 20270919000020 -> 20270919000030 -> depois -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"

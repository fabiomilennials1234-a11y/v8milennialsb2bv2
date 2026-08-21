#!/usr/bin/env bash
#
# Cria uma branch do Supabase UTILIZÁVEL, ou derruba uma existente.
#
# POR QUE ESTE SCRIPT EXISTE
# --------------------------
# `supabase branches create` sozinho produz uma branch INSERVÍVEL. Medido em
# 2026-08-20 e reproduzido em duas branches independentes:
#
#   1. O provisionamento do Supabase roda a própria migração em background,
#      FALHA, e deixa 3 linhas em `supabase_migrations.schema_migrations`
#      apontando para migrations que NUNCA criaram objeto nenhum. É isso que
#      produz o status MIGRATIONS_FAILED.
#   2. Um `supabase db push` seguinte lê o ledger, conclui que o baseline já
#      foi aplicado, e começa da 4ª migration — que morre com
#      `relation "public.sale_events" does not exist`.
#   3. Retry não resolve: o ledger continua mentindo. A branch está morta.
#
# O baseline e a cadeia de migrations estão CORRETOS: com o ledger zerado, as
# 129 migrations aplicam de ponta a ponta (293 tabelas). O conserto é apagar as
# linhas fantasma ANTES do primeiro push. É o que este script faz.
#
# Uso:
#   ./scripts/supabase-branch.sh criar <nome>
#   ./scripts/supabase-branch.sh derrubar <ref>
#
# Branch de preview é projeto separado e CUSTA POR HORA. Derrube ao terminar.

set -euo pipefail

PROD_REF="jsjsmuncfkbsbzqzqhfq"
ACAO="${1:-}"
ALVO="${2:-}"

falha() { echo "erro: $*" >&2; exit 1; }

[ -n "$ACAO" ] || falha "uso: $0 criar <nome> | derrubar <ref>"

if [ "$ACAO" = "derrubar" ]; then
  [ -n "$ALVO" ] || falha "informe o ref da branch"
  [ "$ALVO" != "$PROD_REF" ] || falha "RECUSADO: $ALVO é PRODUÇÃO"
  supabase branches delete "$ALVO" --project-ref "$PROD_REF"
  exit 0
fi

[ "$ACAO" = "criar" ] || falha "ação desconhecida: $ACAO"
[ -n "$ALVO" ] || falha "informe o nome da branch"

echo "==> criando branch '$ALVO'"
REF=$(supabase branches create "$ALVO" --project-ref "$PROD_REF" --experimental 2>&1 \
      | grep -oE "^   [a-z]{20}" | tr -d ' ' | head -1)
[ -n "$REF" ] || falha "não consegui obter o ref da branch criada"
[ "$REF" != "$PROD_REF" ] || falha "RECUSADO: ref resolveu para PRODUÇÃO"
echo "    ref: $REF"

echo "==> aguardando ficar saudável"
for _ in $(seq 1 40); do
  ST=$(supabase branches get "$REF" --project-ref "$PROD_REF" 2>/dev/null \
       | grep -oE "ACTIVE_HEALTHY|CREATING_PROJECT|COMING_UP" | head -1 || true)
  [ "$ST" = "ACTIVE_HEALTHY" ] && break
  sleep 15
done
[ "${ST:-}" = "ACTIVE_HEALTHY" ] || falha "branch não ficou saudável a tempo"

LINHA=$(supabase branches get "$REF" --project-ref "$PROD_REF" 2>/dev/null | sed -n '5p')
SENHA=$(echo "$LINHA" | awk -F'|' '{gsub(/ /,"",$4); print $4}')
[ -n "$SENHA" ] || falha "não consegui a senha da branch"
DB="postgresql://postgres:${SENHA}@db.${REF}.supabase.co:5432/postgres"

echo "==> limpando o ledger fantasma (a correção)"
psql "$DB" -q -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;" \
              -c "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);"
FANTASMA=$(psql "$DB" -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations")
psql "$DB" -q -c "DELETE FROM supabase_migrations.schema_migrations;"
echo "    apagadas $FANTASMA linha(s) que não correspondiam a objeto nenhum"

echo "==> aplicando as migrations (pode levar ~10 min)"
supabase db push --db-url "$DB"

TAB=$(psql "$DB" -t -A -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
LED=$(psql "$DB" -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations")
echo
echo "==> pronta: $TAB tabelas, $LED migrations no ledger"
echo "    ref:    $REF"
echo "    db-url: postgresql://postgres:<senha>@db.${REF}.supabase.co:5432/postgres"
echo
echo "    CUSTA POR HORA. Ao terminar:  $0 derrubar $REF"

#!/usr/bin/env bash
# ============================================================================
# Único caminho autorizado para aplicar migration em banco Supabase neste repo.
#
# Existe porque `supabase db push` na mão já escreveu em PROD por URL/ref
# errado. A defesa não pode ser disciplina — tem que ser mecânica. Ver
# `.specs/project/runbook-validacao-local.md` e a seção "GUARDA MECÂNICA de
# escrita" do CLAUDE.md.
#
# O que este script recusa, em ordem:
#   1. URL que contenha o ref de PROD.
#   2. URL que contenha o ref do dev APOSENTADO.
#   3. Checkout linkado — link ambiente é o vetor do acidente; o alvo tem que
#      vir explícito na linha de comando, sempre.
#   4. Migration pendente que toque DADO (INSERT/UPDATE/DELETE/TRUNCATE/COPY)
#      sem `--allow-dml`. Migration é só schema: assim URL errada vira erro de
#      schema recuperável, não mudança de dado de cliente.
#   5. Confirmação ausente. Em terminal, pergunta. Sem terminal (agente, CI),
#      exige `--confirm <ref>` batendo com o ref extraído da própria URL — não
#      dá pra confirmar sem ter lido o alvo.
#
# Uso:
#   scripts/db-push-branch.sh --db-url "postgresql://..."
#   scripts/db-push-branch.sh --db-url "postgresql://..." --confirm abcdefghijklmnopqrst
#   scripts/db-push-branch.sh --db-url "postgresql://..." --allow-dml
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

PROD_REF="jsjsmuncfkbsbzqzqhfq"
DEV_APOSENTADO_REF="bcfadphgsibjzivtbjvc"
MIGRATIONS_DIR="supabase/migrations"

DB_URL=""
CONFIRM_REF=""
ALLOW_DML=0

die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[1;36m→\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --db-url)   DB_URL="${2:-}"; shift 2 ;;
    --confirm)  CONFIRM_REF="${2:-}"; shift 2 ;;
    --allow-dml) ALLOW_DML=1; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *) die "Argumento desconhecido: $1" ;;
  esac
done

[ -n "$DB_URL" ] || die "Falta --db-url. O alvo nunca é implícito."

# ── Guarda 1 e 2: refs proibidos ────────────────────────────────────────────
case "$DB_URL" in
  *"$PROD_REF"*)
    die "RECUSADO: a URL aponta para PROD ($PROD_REF).
    Prod é botão do humano. Este script não escreve em prod, com nenhuma flag." ;;
esac
case "$DB_URL" in
  *"$DEV_APOSENTADO_REF"*)
    die "RECUSADO: a URL aponta para o dev APOSENTADO ($DEV_APOSENTADO_REF).
    Esse projeto está fora de uso e centenas de migrations atrás. Use branch efêmera." ;;
esac

# ── Extrai o ref do alvo, para a confirmação não-interativa ─────────────────
TARGET_REF="$(printf '%s' "$DB_URL" \
  | grep -oE '(postgres\.[a-z]{20}|db\.[a-z]{20}\.supabase)' \
  | head -1 | grep -oE '[a-z]{20}' || true)"
[ -n "$TARGET_REF" ] || die "Não consegui extrair o project ref da URL. Confira o formato."

# ── Guarda 3: checkout tem de estar NÃO-LINKADO ─────────────────────────────
if [ -f supabase/.temp/project-ref ]; then
  LINKED="$(cat supabase/.temp/project-ref)"
  die "RECUSADO: checkout está linkado ao projeto '$LINKED'.
    Link ambiente é o vetor do acidente — um push sem --db-url iria pra lá.
    Rode 'supabase unlink' e tente de novo."
fi

info "Alvo: $TARGET_REF (não é prod, não é o dev aposentado)"

# ── Dry-run: descobre o que seria aplicado ──────────────────────────────────
info "Rodando dry-run..."
set +e
DRY_OUT="$(supabase db push --db-url "$DB_URL" --dry-run 2>&1)"
DRY_RC=$?
set -e
printf '%s\n' "$DRY_OUT"
[ $DRY_RC -eq 0 ] || die "dry-run falhou (exit $DRY_RC). Nada foi aplicado."

PENDING="$(printf '%s\n' "$DRY_OUT" | grep -oE '[0-9]{14}[A-Za-z0-9_]*\.sql' | sort -u || true)"
if [ -z "$PENDING" ]; then
  ok "Nada pendente. Alvo já está em dia com o repo."
  exit 0
fi

PENDING_COUNT="$(printf '%s\n' "$PENDING" | wc -l | tr -d ' ')"
printf '\n\033[1;33m%s migration(s) seriam aplicadas:\033[0m\n' "$PENDING_COUNT"
printf '%s\n' "$PENDING" | sed 's/^/    /'

# ── Guarda 4: migration é só schema ─────────────────────────────────────────
DML_HITS=""
for f in $PENDING; do
  path="$MIGRATIONS_DIR/$f"
  [ -f "$path" ] || continue
  # Tira comentários de linha antes de procurar DML, pra não acusar a prosa
  # do cabeçalho — estes arquivos explicam bastante em comentário.
  hits="$(sed -e 's/--.*$//' "$path" \
    | grep -inE '^[[:space:]]*(INSERT[[:space:]]+INTO|UPDATE[[:space:]]+|DELETE[[:space:]]+FROM|TRUNCATE|COPY)[[:space:]]' \
    || true)"
  if [ -n "$hits" ]; then
    DML_HITS="${DML_HITS}
  ${f}:
$(printf '%s\n' "$hits" | sed 's/^/      /')"
  fi
done

if [ -n "$DML_HITS" ]; then
  if [ "$ALLOW_DML" -eq 0 ]; then
    die "RECUSADO: migration pendente toca DADO, não só schema:${DML_HITS}

    Migration é só schema (guarda F4 do CLAUDE.md): assim um alvo errado vira
    erro de schema recuperável, não mudança de dado de cliente.
    Se o DML for realmente necessário e revisado, repita com --allow-dml."
  fi
  printf '\n\033[1;33m⚠ DML presente, liberado por --allow-dml:\033[0m%s\n' "$DML_HITS"
fi

# ── Guarda 5: confirmação ───────────────────────────────────────────────────
if [ -t 0 ]; then
  printf '\nDigite o ref do alvo (\033[1m%s\033[0m) para aplicar: ' "$TARGET_REF"
  read -r TYPED
  [ "$TYPED" = "$TARGET_REF" ] || die "Confirmação não bateu. Nada foi aplicado."
else
  [ -n "$CONFIRM_REF" ] || die "Sem terminal: exige --confirm <ref>. Alvo é '$TARGET_REF'."
  [ "$CONFIRM_REF" = "$TARGET_REF" ] \
    || die "--confirm '$CONFIRM_REF' não bate com o alvo da URL ('$TARGET_REF'). Nada foi aplicado."
fi

# ── Aplica ──────────────────────────────────────────────────────────────────
info "Aplicando em $TARGET_REF..."
supabase db push --db-url "$DB_URL"
ok "Aplicado em $TARGET_REF."

printf '\n\033[1;33mBranch efêmera custa ~$0.013/h. Encerre agora que o teste acabou.\033[0m\n'

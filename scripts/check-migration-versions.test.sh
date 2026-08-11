#!/usr/bin/env bash
# Teste do guarda de colisão de versão de migration (issue #1534).
#
# Prova as DUAS pontas, porque só a vermelha não basta: um guarda que reprova
# sempre passaria por "funcionando". O controle negativo é o que separa gate de
# alarme travado.
#
# Exercita o caminho REAL — branch de verdade contra a base de verdade —, e não
# um diretório temporário: metade (b) lê o que a branch INTRODUZ via
# `git diff --diff-filter=A merge-base...HEAD`, e um fixture solto em /tmp não
# tem branch nem merge-base para ler.
set -uo pipefail

RAIZ="$(git rev-parse --show-toplevel)"
GUARD="$RAIZ/scripts/check-migration-versions.sh"
BASE="${MIGRATION_BASE_REF:-origin/main}"
TMP="$(mktemp -d)"
WT="$TMP/wt"
falhas=0

limpar() {
  git -C "$RAIZ" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpar EXIT

# Uma versão que a base COMPROVADAMENTE já tem — lida do próprio repositório, não
# escrita à mão, senão o teste apodrece quando essa migration for arquivada.
OCUPADA="$(git -C "$RAIZ" ls-tree -r --name-only "$BASE" supabase/migrations/ \
            | sed 's|.*/||' | grep -oE '^[0-9]{14}' | sort -u | tail -1)"
# E uma que ninguém tem.
LIVRE="29991231235959"

if [ -z "$OCUPADA" ]; then
  echo "ERRO: não consegui ler nenhuma versão de $BASE. O teste não pode afirmar nada." >&2
  exit 1
fi

git -C "$RAIZ" worktree add --detach "$WT" "$BASE" >/dev/null 2>&1 || {
  echo "ERRO: não consegui criar worktree de teste." >&2; exit 1; }

# Planta UM arquivo na versão $1, REMOVENDO antes o arquivo que a base tem nessa
# versão. A remoção é o que isola a metade (b): sem ela o checkout fica com dois
# arquivos do mesmo prefixo e a metade (a) prende o caso — o teste passaria por
# dois motivos, e ficaria verde mesmo com (b) arrancada.
rodar() {  # $1 = versão do arquivo plantado
  git -C "$WT" reset --hard "$BASE" >/dev/null 2>&1
  rm -f "$WT"/supabase/migrations/"$1"_*.sql
  printf -- '-- fixture do teste do guarda\n' > "$WT/supabase/migrations/$1_guard_fixture.sql"
  git -C "$WT" add -A supabase/migrations >/dev/null 2>&1
  git -C "$WT" -c user.email=t@t -c user.name=t commit -qm "fixture $1" >/dev/null 2>&1
  ( cd "$WT" && bash "$GUARD" >/dev/null 2>&1 )
}

# Dois arquivos com a MESMA versão nova dentro do checkout. Isola a metade (a):
# a versão não existe na base, então (b) não tem o que dizer.
rodar_dup() {
  git -C "$WT" reset --hard "$BASE" >/dev/null 2>&1
  printf -- '-- a\n' > "$WT/supabase/migrations/${LIVRE}_guard_fixture_a.sql"
  printf -- '-- b\n' > "$WT/supabase/migrations/${LIVRE}_guard_fixture_b.sql"
  git -C "$WT" add -A supabase/migrations >/dev/null 2>&1
  git -C "$WT" -c user.email=t@t -c user.name=t commit -qm "fixture dup" >/dev/null 2>&1
  ( cd "$WT" && bash "$GUARD" >/dev/null 2>&1 )
}

# --- VERMELHO: versão que a base já tem tem que REPROVAR ---------------------
if rodar "$OCUPADA"; then
  echo "FALHOU: o guarda passou com a versão $OCUPADA, que já existe em $BASE." >&2
  echo "        É a colisão que o db push pularia em silêncio." >&2
  falhas=$((falhas + 1))
else
  echo "ok — versão já existente em $BASE reprova ($OCUPADA)"
fi

# --- VERMELHO (a): duas do mesmo prefixo no checkout. Morre se BASELINE > 0 ---
if rodar_dup; then
  echo "FALHOU: o guarda passou com DUAS migrations do mesmo prefixo no checkout." >&2
  echo "        Provável BASELINE > 0 — folga que tolera colisão nova." >&2
  falhas=$((falhas + 1))
else
  echo "ok — duas do mesmo prefixo no checkout reprovam ($LIVRE)"
fi

# --- VERDE: controle negativo. Sem ele, guarda travado passaria por bom ------
if rodar "$LIVRE"; then
  echo "ok — versão livre passa ($LIVRE)"
else
  echo "FALHOU: o guarda reprovou a versão livre $LIVRE." >&2
  echo "        Guarda que reprova sempre é indistinguível de guarda quebrado." >&2
  falhas=$((falhas + 1))
fi

[ "$falhas" -eq 0 ] && echo "guarda de colisão: 3/3" || echo "guarda de colisão: $falhas falha(s)" >&2
exit "$falhas"

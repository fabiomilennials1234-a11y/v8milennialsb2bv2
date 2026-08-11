#!/usr/bin/env bash
# Teste do guarda de colisão de versão de migration (issue #1534).
#
# Monta a história num repositório temporário em vez de depender da topologia do
# repositório real: os casos que importam são sobre QUANDO cada commit aconteceu
# (a branch bifurca, DEPOIS a base ganha o gêmeo), e isso não se reproduz de
# forma determinística a partir de commits históricos.
#
# Quatro casos. Cada um morre por uma mudança pontual diferente no guarda, e os
# dois controles negativos existem porque guarda que reprova sempre passaria por
# funcionando.
set -uo pipefail

GUARD="$(cd "$(dirname "$0")" && pwd)/check-migration-versions.sh"
TMP="$(mktemp -d)"
falhas=0
trap 'rm -rf "$TMP"' EXIT

git init -q "$TMP/repo"
cd "$TMP/repo"
git config user.email t@t; git config user.name t
mkdir -p supabase/migrations

commitar() { git add -A >/dev/null 2>&1; git commit -qm "$1" >/dev/null 2>&1; }
mig() { printf -- '-- %s\n' "$2" > "supabase/migrations/$1_$2.sql"; }

mig 20250101000000 inicial && commitar base-inicial
git branch -M base

roda_em() {  # $1 = branch a testar
  git checkout -q "$1"
  ( MIGRATION_BASE_REF=base bash "$GUARD" supabase/migrations supabase/migrations >/dev/null 2>&1 )
}

checar() {  # $1 = branch, $2 = esperado (falha|passa), $3 = descrição
  if roda_em "$1"; then res=passa; else res=falha; fi
  if [ "$res" = "$2" ]; then
    echo "ok — $3"
  else
    echo "FALHOU: $3 (esperado $2, deu $res)" >&2
    falhas=$((falhas + 1))
  fi
}

# --- (1) GÊMEO TARDIO: a branch bifurca, DEPOIS a base ganha a mesma versão ---
# É a forma de TODAS as colisões reais de 2026-08-11. Se `base_versions` for lido
# no merge-base em vez da ponta da base, este caso passa em silêncio — o gêmeo
# ainda não existe lá.
git checkout -q -b gemeo-tardio base
mig 20260202000000 metrica_da_branch && commitar branch-adiciona
git checkout -q base
mig 20260202000000 billing_da_base && commitar base-ganha-gemeo-depois
checar gemeo-tardio falha "gêmeo que chega na base DEPOIS do fork reprova"

# --- (2) CHERRY-PICK: mesma versão, MESMO nome. Não é colisão -----------------
# O git funde o mesmo caminho e sobra um arquivo só. Acusar aqui é falso vermelho.
git checkout -q -b cherry base
mig 20260303000000 mesmo_arquivo && commitar base-tem
git checkout -q base && git merge -q --no-ff -m merge cherry >/dev/null 2>&1
git checkout -q -b cherry2 base~1 2>/dev/null || git checkout -q -b cherry2 base
mig 20260303000000 mesmo_arquivo && commitar branch-readiciona-igual
checar cherry2 passa "mesma versão com o MESMO nome (cherry-pick) não reprova"

# --- (3) DUPLICATA DENTRO DO CHECKOUT: isola a metade (a) --------------------
git checkout -q -b dup base
mig 20260404000000 arquivo_a && mig 20260404000000 arquivo_b && commitar duas-iguais
checar dup falha "duas do mesmo prefixo no checkout reprovam"

# --- (4) CONTROLE NEGATIVO: versão livre tem que PASSAR ----------------------
git checkout -q -b livre base
mig 20260505000000 versao_livre && commitar livre
checar livre passa "versão livre passa"

if [ "$falhas" -eq 0 ]; then echo "guarda de colisão: 4/4"; else echo "guarda de colisão: $falhas falha(s)" >&2; fi
exit "$falhas"

#!/usr/bin/env bash
#
# Prova por mutação do validador de template
# (`supabase/functions/_shared/notificame-template-validate.ts`).
#
# Este validador é a última chance de pegar um erro antes de ele virar uma
# submissão à Meta que volta REJECTED horas depois, com motivo genérico. Uma
# regra que não é testada é uma regra que pode ter sido escrita errada e ninguém
# descobre — o sintoma (recusa opaca) é idêntico ao de não ter regra nenhuma.
#
# Uso:  bash scripts/mutation/notificame-template-validate.sh
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/supabase/functions/_shared/notificame-template-validate.ts"
TEST="tests/unit/notificame-template-validate.test.ts"

BAK="$(mktemp)"
cp "$SRC" "$BAK"
restore() { cp "$BAK" "$SRC"; rm -f "$BAK"; }
trap restore EXIT

survivors=0

run_mutation() {
  local name="$1"; shift
  cp "$BAK" "$SRC"
  "$@"

  local out
  out=$(cd "$REPO" && npx vitest run "$TEST" 2>&1 |
    sed $'s/\033\\[[0-9;]*m//g' | grep -E "Tests +[0-9]" | tail -1)

  if echo "$out" | grep -q "failed"; then
    echo "ok    mutante morto  — $name  ($(echo "$out" | xargs))"
  else
    echo "FALHA MUTANTE VIVO   — $name  ($(echo "$out" | xargs))"
    survivors=$((survivors + 1))
  fi
}

m_name()      { perl -0pi -e 's/const NAME_RE = \/\^\[a-z0-9_\]\+\$\/;/const NAME_RE = \/.*\/; \/\/ MUTANTE/' "$SRC"; }
m_body()      { perl -0pi -e 's/add\("body_required", "O template precisa de um corpo", "body"\);/\/\/ MUTANTE/' "$SRC"; }
m_gap()       { perl -0pi -e 's/const completa = distintas\.every\(\(n, i\) => n === i \+ 1\);/const completa = true; \/\/ MUTANTE/' "$SRC"; }
m_mixed()     { perl -0pi -e 's/if \(all\.positional\.length > 0 && all\.named\.length > 0\) \{/if (false) {/' "$SRC"; }
m_footer()    { perl -0pi -e 's/if \(vars\.positional\.length \+ vars\.named\.length > 0\) \{/if (false) {/' "$SRC"; }
m_header()    { perl -0pi -e 's/if \(vars\.positional\.length \+ vars\.named\.length > 1\) \{/if (false) {/' "$SRC"; }
m_dup()       { perl -0pi -e 's/if \(componentsOfType\(draft, type\)\.length > 1\) \{/if (false) {/' "$SRC"; }
m_bodymax()   { perl -0pi -e 's/else if \(text\.length > BODY_MAX\) \{/else if (false) {/' "$SRC"; }
m_category()  { perl -0pi -e 's/if \(!CATEGORIES\.has\(draft\.category\)\) \{/if (false) {/' "$SRC"; }

run_mutation "formato do nome"                    m_name
run_mutation "corpo obrigatório"                  m_body
run_mutation "sequência posicional sem buraco"    m_gap
run_mutation "não misturar formatos de variável"  m_mixed
run_mutation "rodapé sem variável"                m_footer
run_mutation "cabeçalho com no máximo uma"        m_header
run_mutation "bloco duplicado"                    m_dup
run_mutation "limite do corpo"                    m_bodymax
run_mutation "categoria válida"                   m_category

cp "$BAK" "$SRC"

# Controle positivo: sem mutação a suíte tem de estar verde. Sem isto, uma suíte
# que aborta por erro de sintaxe contaria como "todos os mutantes mortos".
control=$(cd "$REPO" && npx vitest run "$TEST" 2>&1 |
  sed $'s/\033\\[[0-9;]*m//g' | grep -E "Tests +[0-9]" | tail -1)
echo "controle (sem mutação): $(echo "$control" | xargs)"

if echo "$control" | grep -q "failed" || [ -z "$control" ]; then
  echo "FALHA: controle não está verde — o resultado acima não vale."
  exit 1
fi

if [ "$survivors" -gt 0 ]; then
  echo "FALHA: $survivors mutante(s) vivo(s)."
  exit 1
fi

echo "OK: 9 mutantes, 9 mortos."

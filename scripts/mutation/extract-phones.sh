#!/usr/bin/env bash
#
# Prova por mutação do extrator de telefone (`src/lib/extractPhones.ts`).
#
# Verde não é prova. Cada guarda do extrator é quebrada de propósito e a suíte
# TEM de ficar vermelha. Guarda que sobrevive à mutação não está sendo testada —
# ou pior, é inalcançável e o teste passa por outro caminho, sem que ninguém veja.
#
# Uso:  bash scripts/mutation/extract-phones.sh
# Saída: uma linha por mutante. Qualquer "MUTANTE VIVO" é falha.
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/src/lib/extractPhones.ts"
TEST="src/lib/extractPhones.test.ts"

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

m_boundary() { perl -0pi -e 's/if \(isDigit\(text\[start - 1\]\) \|\| isDigit\(text\[start \+ raw\.length\]\)\) continue;/\/\/ MUTANTE/' "$SRC"; }
m_len()      { perl -0pi -e 's/if \(digits\.length !== 10 && digits\.length !== 11\) continue;/\/\/ MUTANTE/' "$SRC"; }
m_ddd()      { perl -0pi -e 's/if \(!VALID_DDD\.has\(ddd\)\) continue;/\/\/ MUTANTE/' "$SRC"; }
m_prefix()   { perl -0pi -e 's/if \(subscriber\.length === 9\) return subscriber\.startsWith\("9"\) \? "mobile" : null;/if (subscriber.length === 9) return "mobile"; \/\/ MUTANTE/' "$SRC"; }
m_landline() { perl -0pi -e 's/if \(LANDLINE_FIRST_DIGITS\.has\(subscriber\[0\]\)\) return "landline";/if (LANDLINE_FIRST_DIGITS.has(subscriber[0])) return "mobile"; \/\/ MUTANTE/' "$SRC"; }
m_repeated() { perl -0pi -e 's/if \(new Set\(subscriber\)\.size === 1\) continue;/\/\/ MUTANTE/' "$SRC"; }
m_dedupe()   { perl -0pi -e 's/if \(!normalized \|\| seen\.has\(normalized\)\) continue;/if (!normalized) continue; \/\/ MUTANTE/' "$SRC"; }
m_ninth()    { perl -0pi -e 's/inferredNinthDigit: subscriber\.length === 8/inferredNinthDigit: false \/* MUTANTE *\//' "$SRC"; }

run_mutation "guarda de fronteira (dígito grudado)"      m_boundary
run_mutation "comprimento 10 ou 11"                       m_len
run_mutation "lista de DDD"                               m_ddd
run_mutation "celular de 9 dígitos começa em 9"           m_prefix
run_mutation "classificação fixo vs celular"              m_landline
run_mutation "dígito repetido é placeholder"              m_repeated
run_mutation "dedupe por telefone normalizado"            m_dedupe
run_mutation "marca do nono dígito inserido"              m_ninth

cp "$BAK" "$SRC"

# Controle positivo: sem mutação a suíte tem de estar verde. Sem isto, uma
# suíte que aborta por erro de sintaxe contaria como "todos os mutantes mortos".
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

echo "OK: 8 mutantes, 8 mortos."

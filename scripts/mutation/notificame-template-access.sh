#!/usr/bin/env bash
#
# Prova por mutação do gate de acesso dos templates
# (`supabase/functions/_shared/notificame-template-access.ts`).
#
# Este gate é a única coisa entre o `instance_id` que o CLIENTE manda e a lista
# de templates de um canal. Verde não é prova: cada guarda é quebrada de
# propósito e a suíte TEM de ficar vermelha. Guarda que sobrevive à mutação não
# está sendo testada — ou é inalcançável, e nesse caso não protege nada.
#
# Uso:  bash scripts/mutation/notificame-template-access.sh
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/supabase/functions/_shared/notificame-template-access.ts"
TEST="tests/unit/notificame-template-access.test.ts"

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

# A guarda de tenancy: sem ela, a org A lê os templates da org B.
m_tenancy()  { perl -0pi -e 's/if \(!row \|\| row\.organization_id !== orgId\) return notFound;/if (!row) return notFound; \/\/ MUTANTE/' "$SRC"; }
# O provider: sem ele, uma instância Uazapi seria tratada como NotificaMe.
m_provider() { perl -0pi -e 's/if \(row\.provider !== "notificame"\) \{/if (false) {/' "$SRC"; }
# O backstop social: canal de Instagram que escapou para whatsapp_instances.
m_social()   { perl -0pi -e 's/if \(declaredType && declaredType !== "whatsapp" && declaredType !== "wa"\) \{/if (false) {/' "$SRC"; }
# O id do fornecedor: sem ele a chamada sai com caminho vazio.
m_chanid()   { perl -0pi -e 's/if \(!channelId\) \{/if (false) {/' "$SRC"; }
# O trim: id só com espaços passaria como se fosse válido.
m_trim()     { perl -0pi -e 's/return typeof value === "string" \? value\.trim\(\) : "";/return typeof value === "string" ? value : "";/' "$SRC"; }
# O silêncio do 404: distinguir "não existe" de "não é seu" cria o oráculo.
m_oracle()   { perl -0pi -e 's/if \(!row \|\| row\.organization_id !== orgId\) return notFound;/if (!row) return notFound;\n  if (row.organization_id !== orgId) return { ok: false, code: "channel_forbidden", status: 403, error: "MUTANTE" };/' "$SRC"; }

run_mutation "guarda de tenancy (org do chamador)"      m_tenancy
run_mutation "oráculo: 403 distinto para org alheia"    m_oracle
run_mutation "provider tem de ser notificame"           m_provider
run_mutation "backstop de canal social"                 m_social
run_mutation "channel_id do fornecedor obrigatório"     m_chanid
run_mutation "trim do channel_id"                       m_trim

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

echo "OK: 6 mutantes, 6 mortos."

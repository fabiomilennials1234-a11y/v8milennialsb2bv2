#!/usr/bin/env bash
# Teste do guarda de alvo de `scripts/test-workflows.sh` (SCRUM-364).
#
# O script fala com um Supabase remoto. Três comportamentos importam, e nenhum
# deles é sobre workflow: sem alvo ele PULA (não morre), com alvo proibido ele
# RECUSA (não pula), e a recusa vale com ou sem chave — senão "deixar verde"
# vira sinônimo de "fornecer o secret que faltava", que é como o repositório
# aprendeu a apontar teste para produção.
#
# Nenhum caso aqui chega a fazer requisição: todos param antes do curl.
set -uo pipefail

ALVO="$(cd "$(dirname "$0")" && pwd)/test-workflows.sh"
falhas=0

checar() {  # $1 = descrição, $2 = exit esperado, $3 = trecho esperado na saída, resto = env
  local desc="$1" esperado="$2" trecho="$3"; shift 3
  local saida codigo
  saida="$(env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u GITHUB_STEP_SUMMARY \
            "$@" bash "$ALVO" 2>&1)"
  codigo=$?
  if [ "$codigo" -eq "$esperado" ] && printf '%s' "$saida" | grep -q "$trecho"; then
    echo "ok — $desc"
  else
    echo "FALHOU: $desc (exit $codigo, esperado $esperado; procurava '$trecho')" >&2
    printf '%s\n' "$saida" | sed 's/^/        /' >&2
    falhas=$((falhas + 1))
  fi
}

checar "sem chave nenhuma, pula em voz alta" 0 "SKIP"
checar "com chave e sem URL, pula — não existe mais default" 0 "SUPABASE_URL não está definida" \
  SUPABASE_SERVICE_ROLE_KEY=fake
checar "URL de produção é recusada mesmo com chave" 1 "RECUSADO" \
  SUPABASE_SERVICE_ROLE_KEY=fake SUPABASE_URL=https://jsjsmuncfkbsbzqzqhfq.supabase.co
checar "URL de produção é recusada TAMBÉM sem chave" 1 "RECUSADO" \
  SUPABASE_URL=https://jsjsmuncfkbsbzqzqhfq.supabase.co
checar "dev aposentado é recusado" 1 "APOSENTADO" \
  SUPABASE_SERVICE_ROLE_KEY=fake SUPABASE_URL=https://bcfadphgsibjzivtbjvc.supabase.co

if [ "$falhas" -eq 0 ]; then
  echo "guarda de alvo: 5/5"
else
  echo "guarda de alvo: $falhas falha(s)" >&2
fi
exit "$falhas"

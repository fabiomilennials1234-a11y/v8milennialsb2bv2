#!/usr/bin/env bash
# Teste da guarda da config de teste do edge (scripts/check-edge-test-config.mjs).
#
# Cada caso copia os três arquivos REAIS (deno.json, deno.test.json e
# deno.test.lock) para um diretório temporário, aplica UMA mutação e confere o
# exit e o trecho da mensagem. Cada vermelho morre por uma regra diferente da
# guarda. O primeiro caso é o controle positivo: os arquivos do repo, como estão,
# têm que passar, e a guarda tem que relatar quantos imports leu, porque sem isso
# "nenhum problema" e "não li nada" são a mesma saída.
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
GUARDA="$RAIZ/scripts/check-edge-test-config.mjs"
ORIGEM="$RAIZ/supabase/functions"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
falhas=0
casos=0

json() {  # $1 = arquivo JSON, $2 = JS que altera `j`
  node -e 'const fs=require("fs"),[a,js]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(a,"utf8"));new Function("j",js)(j);fs.writeFileSync(a,JSON.stringify(j,null,2)+"\n")' "$1" "$2"
}

checar() {  # $1 = descrição, $2 = exit esperado, $3 = trecho esperado na saída, $4 = mutação (shell, roda no caso)
  local desc="$1" esperado="$2" trecho="$3" mutacao="$4" saida codigo
  casos=$((casos + 1))
  rm -rf "$TMP/caso" && mkdir -p "$TMP/caso"
  cp "$ORIGEM/deno.json" "$ORIGEM/deno.test.json" "$ORIGEM/deno.test.lock" "$TMP/caso/"
  if ! (cd "$TMP/caso" && eval "$mutacao"); then
    echo "FALHOU: $desc (a mutação não aplicou)" >&2
    falhas=$((falhas + 1))
    return
  fi
  saida="$(env -u GITHUB_ACTIONS node "$GUARDA" "$TMP/caso" 2>&1)"
  codigo=$?
  if [ "$codigo" -eq "$esperado" ] && printf '%s' "$saida" | grep -qF -- "$trecho"; then
    echo "ok — $desc"
  else
    echo "FALHOU: $desc (exit $codigo, esperado $esperado; procurava '$trecho')" >&2
    printf '%s\n' "$saida" | sed 's/^/        /' >&2
    falhas=$((falhas + 1))
  fi
}

imports_do_deploy="$(node -e 'const fs=require("fs");console.log(Object.keys(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).imports).length)' "$ORIGEM/deno.json")"

# --- controles positivos -------------------------------------------------------
checar "os arquivos do repo passam e a guarda relata o que leu" 0 \
  "ok: $imports_do_deploy imports do deploy cobertos" 'true'
checar "deno.json sem imports reprova: zero verificado não é verde" 1 \
  "a guarda não verificou nada" 'json deno.json "delete j.imports"'

# --- deriva entre deploy e teste -----------------------------------------------
checar "import novo no deploy sem par no teste reprova" 1 \
  '"openai" está nos imports do deno.json e falta no deno.test.json' \
  'json deno.json "j.imports.openai = \"npm:openai@4.0.0\""'
checar "fora do esm.sh, alvo diferente do deploy reprova" 1 \
  '"std/": o deploy usa https://deno.land/std@0.224.0/' \
  'json deno.json "j.imports[\"std/\"] = \"https://deno.land/std@0.224.0/\""'

# --- o que entra no lugar do esm.sh ----------------------------------------------
checar "npm: sem versão exata reprova" 1 \
  '"@supabase/supabase-js": no deploy é https://esm.sh/@supabase/supabase-js@2; no teste tem que ser npm: com versão exata' \
  'json deno.test.json "j.imports[\"@supabase/supabase-js\"] = j.imports[\"https://esm.sh/@supabase/supabase-js@2\"] = \"npm:@supabase/supabase-js@2\""'
checar "sem a chave-URL, os imports diretos voltariam ao esm.sh: reprova" 1 \
  'a URL https://esm.sh/@supabase/supabase-js@2 tem que ser chave do deno.test.json' \
  'json deno.test.json "delete j.imports[\"https://esm.sh/@supabase/supabase-js@2\"]"'
checar "alvo do teste no esm.sh reprova" 1 \
  '"zod" aponta para o esm.sh no deno.test.json' \
  'json deno.test.json "j.imports.zod = \"https://esm.sh/zod@3.23.8\""'

# --- execução: config e lock da config de teste --------------------------------
checar "task de deno test sem --config deno.test.json reprova" 1 \
  'a task "test" roda' \
  'json deno.test.json "j.tasks.test = j.tasks.test.replace(\"--config deno.test.json \", \"\")"'
checar "lock que não é congelado reprova" 1 \
  'tem que declarar "lock": { "path": "./deno.test.lock", "frozen": true }' \
  'json deno.test.json "j.lock.frozen = false"'
checar "config de teste apontando para o deno.lock de deploy reprova" 1 \
  'aponta para o deno.lock de DEPLOY' \
  'json deno.test.json "j.lock.path = \"./deno.lock\""'

# --- o lock de teste -------------------------------------------------------------
checar "lock de teste ausente reprova" 1 "lock de teste ausente" 'rm deno.test.lock'
checar "lock de teste vazio reprova" 1 "lock de teste vazio" ': > deno.test.lock'
checar "lock de teste com a entrada do esm.sh que derrubava o CI reprova" 1 \
  "o lock de teste tem 1 ocorrência(s) de https://esm.sh/" \
  'json deno.test.lock "j.remote[\"https://esm.sh/tslib@2.8.1/denonext/tslib.mjs\"] = \"c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9\""'

if [ "$falhas" -eq 0 ]; then
  echo "guarda da config de teste do edge: $casos/$casos"
else
  echo "guarda da config de teste do edge: $falhas falha(s) em $casos" >&2
fi
exit "$falhas"

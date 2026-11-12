#!/usr/bin/env bash
# Teste da guarda da config de teste do edge (scripts/check-edge-test-config.mjs).
#
# Cada caso copia os quatro arquivos REAIS (deno.json e deno.lock de deploy,
# deno.test.json e deno.test.lock) para um diretório temporário, aplica UMA
# mutação e confere o exit e os trechos da mensagem. Cada vermelho isola uma
# regra da guarda, ou uma condição dela (pacote, caminho, versão, range,
# redirect). O primeiro caso é o controle positivo: os arquivos do repo, como
# estão, têm que passar, e a guarda tem que relatar quantos imports leu, porque
# sem isso "nenhum problema" e "não li nada" são a mesma saída.
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

# $1 = descrição, $2 = exit esperado, $3 = trecho esperado na saída, $4 = mutação
# (shell, roda no caso), $5... = mais trechos esperados; "!trecho" = não pode aparecer.
checar() {
  local desc="$1" esperado="$2" mutacao="$4" saida codigo trecho faltou=""
  local trechos=("$3" "${@:5}")
  casos=$((casos + 1))
  rm -rf "$TMP/caso" && mkdir -p "$TMP/caso"
  cp "$ORIGEM/deno.json" "$ORIGEM/deno.lock" "$ORIGEM/deno.test.json" "$ORIGEM/deno.test.lock" "$TMP/caso/"
  if ! (cd "$TMP/caso" && eval "$mutacao"); then
    echo "FALHOU: $desc (a mutação não aplicou)" >&2
    falhas=$((falhas + 1))
    return
  fi
  saida="$(env -u GITHUB_ACTIONS node "$GUARDA" "$TMP/caso" 2>&1)"
  codigo=$?
  for trecho in "${trechos[@]}"; do
    if [ "${trecho:0:1}" = "!" ]; then
      printf '%s' "$saida" | grep -qF -- "${trecho:1}" && faltou="$trecho"
    else
      printf '%s' "$saida" | grep -qF -- "$trecho" || faltou="$trecho"
    fi
  done
  if [ "$codigo" -eq "$esperado" ] && [ -z "$faltou" ]; then
    echo "ok — $desc"
  else
    echo "FALHOU: $desc (exit $codigo, esperado $esperado${faltou:+; trecho '$faltou'})" >&2
    printf '%s\n' "$saida" | sed 's/^/        /' >&2
    falhas=$((falhas + 1))
  fi
}

conta() {  # $1 = JS sobre `d` (imports do deno.json) que devolve um número
  node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).imports;console.log(eval(process.argv[2]))' \
    "$ORIGEM/deno.json" "$1"
}
imports_do_deploy="$(conta 'Object.keys(d).length')"
esm_do_deploy="$(conta 'Object.values(d).filter((a) => a.startsWith("https://esm.sh/")).length')"
LOCK='npm run test:edge:lock'

# --- controles positivos -------------------------------------------------------
checar "os arquivos do repo passam e a guarda relata o que leu" 0 \
  "ok: $imports_do_deploy imports do deploy cobertos" 'true' \
  "($esm_do_deploy trocados de esm.sh por npm: do mesmo pacote; versão igual em $esm_do_deploy" '!AVISO'
checar "deno.json sem imports reprova: zero verificado não é verde" 1 \
  "a guarda não verificou nada" 'json deno.json "delete j.imports"'
checar "deno.json que é JSON mas não é objeto reprova" 1 "deno.json não é um objeto JSON" 'echo "[]" > deno.json'

# --- deriva entre deploy e teste -----------------------------------------------
checar "import novo no deploy sem par no teste reprova" 1 \
  '"openai" está nos imports do deno.json e falta no deno.test.json' \
  'json deno.json "j.imports.openai = \"npm:openai@4.0.0\""'
checar "fora do esm.sh, alvo diferente do deploy reprova" 1 \
  '"std/": o deploy usa https://deno.land/std@0.224.0/' \
  'json deno.json "j.imports[\"std/\"] = \"https://deno.land/std@0.224.0/\""'
# M5 da revisão do PR #2494 (passava com exit 0).
checar "M5: chave só do teste, que não é chave-URL do esm.sh, reprova" 1 \
  '"lodash" está no deno.test.json e não existe no deno.json: o teste resolveria um specifier que o deploy não resolve' \
  'json deno.test.json "j.imports.lodash = \"npm:lodash@4.17.21\""'

# --- o que entra no lugar do esm.sh ----------------------------------------------
checar "npm: sem versão exata reprova" 1 \
  '"@supabase/supabase-js": no deploy é https://esm.sh/@supabase/supabase-js@2; no teste tem que ser npm: com versão exata' \
  'json deno.test.json "j.imports[\"@supabase/supabase-js\"] = j.imports[\"https://esm.sh/@supabase/supabase-js@2\"] = \"npm:@supabase/supabase-js@2\""'
checar "sem a chave-URL, os imports diretos voltariam ao esm.sh: reprova" 1 \
  'a URL https://esm.sh/@supabase/supabase-js@2, alvo de "@supabase/supabase-js" no deno.json, falta como chave no deno.test.json' \
  'json deno.test.json "delete j.imports[\"https://esm.sh/@supabase/supabase-js@2\"]"' \
  "para npm:@supabase/supabase-js@2.105.4, a versão do deploy, e rode $LOCK"
checar "alvo do teste no esm.sh reprova" 1 \
  '"zod" aponta para o esm.sh no deno.test.json' \
  'json deno.test.json "j.imports.zod = \"https://esm.sh/zod@3.23.8\""'

# --- mesmo pacote e mesma versão do deploy -------------------------------------
# M1 a M4 da revisão do PR #2494: todos passavam com exit 0.
checar "M1: deploy sobe o zod para 3.24.1 e o teste fica em 3.23.8, com a chave-URL nova: reprova" 1 \
  '"zod": o teste usa zod 3.23.8 (npm:zod@3.23.8) e o deploy, 3.24.1 (https://esm.sh/zod@3.24.1): tem que ser a mesma versão' \
  'json deno.json "j.imports.zod = \"https://esm.sh/zod@3.24.1\"" &&
   json deno.test.json "delete j.imports[\"https://esm.sh/zod@3.23.8\"]; j.imports[\"https://esm.sh/zod@3.24.1\"] = \"npm:zod@3.23.8\""' \
  "aponte o \"zod\" e a chave-URL \"https://esm.sh/zod@3.24.1\" para npm:zod@3.24.1, a versão do deploy, e rode $LOCK"
checar "M2: deploy sobe o jose para 6.0.0 e o teste fica em 5.9.6, com a chave-URL nova: reprova" 1 \
  '"jose": o teste usa jose 5.9.6 (npm:jose@5.9.6) e o deploy, 6.0.0 (https://esm.sh/jose@6.0.0): tem que ser a mesma versão' \
  'json deno.json "j.imports.jose = \"https://esm.sh/jose@6.0.0\"" &&
   json deno.test.json "delete j.imports[\"https://esm.sh/jose@5.9.6\"]; j.imports[\"https://esm.sh/jose@6.0.0\"] = \"npm:jose@5.9.6\""'
checar "M3: o zod e a URL do zod apontando para o pacote jose reprova" 1 \
  '"zod": o teste importa o pacote jose (npm:jose@5.9.6) e o deploy, o pacote zod (https://esm.sh/zod@3.23.8): tem que ser o mesmo pacote' \
  'json deno.test.json "j.imports.zod = j.imports[\"https://esm.sh/zod@3.23.8\"] = \"npm:jose@5.9.6\""'
checar "M4: deploy sobe o supabase-js para @3 e o teste fica em 2.105.4, com a chave-URL nova: reprova" 1 \
  '"@supabase/supabase-js": o teste usa @supabase/supabase-js 2.105.4 (npm:@supabase/supabase-js@2.105.4) e o deploy, o range "3" (https://esm.sh/@supabase/supabase-js@3, sem redirect no deno.lock de deploy): sem o redirect, a versão do teste tem que estar dentro do range' \
  'json deno.json "j.imports[\"@supabase/supabase-js\"] = \"https://esm.sh/@supabase/supabase-js@3\"" &&
   json deno.test.json "j.imports[\"https://esm.sh/@supabase/supabase-js@3\"] = \"npm:@supabase/supabase-js@2.105.4\""'
checar "deploy e teste sobem juntos o zod para 3.24.1: passa (o lock velho, quem barra é o --frozen)" 0 \
  "ok: $imports_do_deploy imports do deploy cobertos" \
  'json deno.json "j.imports.zod = \"https://esm.sh/zod@3.24.1\"" &&
   json deno.test.json "delete j.imports[\"https://esm.sh/zod@3.23.8\"]; j.imports.zod = j.imports[\"https://esm.sh/zod@3.24.1\"] = \"npm:zod@3.24.1\""' \
  '!AVISO' '!FALHA'
checar "só o deploy sobe o zod: a mensagem manda pôr nome curto e chave-URL na versão NOVA e rodar o lock" 1 \
  'a URL https://esm.sh/zod@3.24.1, alvo de "zod" no deno.json, falta como chave no deno.test.json' \
  'json deno.json "j.imports.zod = \"https://esm.sh/zod@3.24.1\""' \
  "aponte o \"zod\" e a chave-URL \"https://esm.sh/zod@3.24.1\" para npm:zod@3.24.1, a versão do deploy, e rode $LOCK"
checar "só a chave-URL do zod apontando para o pacote jose reprova" 1 \
  'a chave-URL "https://esm.sh/zod@3.23.8": o teste importa o pacote jose (npm:jose@5.9.6) e o deploy, o pacote zod' \
  'json deno.test.json "j.imports[\"https://esm.sh/zod@3.23.8\"] = \"npm:jose@5.9.6\""'
checar "mesmo pacote e versão, mas outro caminho do pacote, reprova" 1 \
  'tem que ser o mesmo caminho do pacote' \
  'json deno.test.json "j.imports.zod = j.imports[\"https://esm.sh/zod@3.23.8\"] = \"npm:zod@3.23.8/lib/index.mjs\""'
checar "chave-URL que sobrou sem par no deploy, em outra versão, reprova" 1 \
  'a chave-URL "https://esm.sh/zod@3.23.8", sem par no deno.json: o teste usa zod 3.24.1 (npm:zod@3.24.1) e o deploy, 3.23.8 (https://esm.sh/zod@3.23.8): tem que ser a mesma versão' \
  'json deno.json "j.imports.zod = \"https://esm.sh/zod@3.24.1\"" &&
   json deno.test.json "j.imports.zod = j.imports[\"https://esm.sh/zod@3.24.1\"] = j.imports[\"https://esm.sh/zod@3.23.8\"] = \"npm:zod@3.24.1\""'
checar "chave-URL do esm.sh sem par no deploy e sem versão reprova" 1 \
  'a chave-URL "https://esm.sh/zod", sem par no deno.json: https://esm.sh/zod não está no formato https://esm.sh/<pacote>@<versão>[/caminho]' \
  'json deno.test.json "j.imports[\"https://esm.sh/zod\"] = \"npm:zod@3.23.8\""'
checar "chave-URL sem par no deploy, em range sem redirect, dentro dele: passa, com aviso" 0 \
  'AVISO: a chave-URL "https://esm.sh/@supabase/supabase-js@2", sem par no deno.json: o deploy usa https://esm.sh/@supabase/supabase-js@2, sem redirect no deno.lock de deploy; aceitei npm:@supabase/supabase-js@2.105.4 por estar dentro do range "2"' \
  'json deno.json "j.imports[\"@supabase/supabase-js\"] = \"https://esm.sh/@supabase/supabase-js@2.105.4\"" &&
   json deno.test.json "j.imports[\"https://esm.sh/@supabase/supabase-js@2.105.4\"] = \"npm:@supabase/supabase-js@2.105.4\"" &&
   json deno.lock "delete j.redirects[\"https://esm.sh/@supabase/supabase-js@2\"]"' \
  "ok: $imports_do_deploy imports do deploy cobertos"
checar "alvo esm.sh do deploy sem versão reprova: a guarda não adivinha o pacote" 1 \
  '"zod": https://esm.sh/zod não está no formato https://esm.sh/<pacote>@<versão>[/caminho]' \
  'json deno.json "j.imports.zod = \"https://esm.sh/zod\""'

# --- range no deploy: a versão vem do redirect do deno.lock de deploy -----------
checar "o deno.lock de deploy passa o @2 para 2.110.0 e o teste fica em 2.105.4: reprova" 1 \
  '"@supabase/supabase-js": o teste usa @supabase/supabase-js 2.105.4 (npm:@supabase/supabase-js@2.105.4) e o deploy, 2.110.0 (https://esm.sh/@supabase/supabase-js@2, que o deno.lock de deploy trava em 2.110.0): tem que ser a mesma versão' \
  'json deno.lock "j.redirects[\"https://esm.sh/@supabase/supabase-js@2\"] = \"https://esm.sh/@supabase/supabase-js@2.110.0\""'
checar "range sem redirect no deno.lock de deploy e teste dentro dele (@2, o major): passa, com aviso" 0 \
  'AVISO: "@supabase/supabase-js": o deploy usa https://esm.sh/@supabase/supabase-js@2, sem redirect no deno.lock de deploy; aceitei npm:@supabase/supabase-js@2.105.4 por estar dentro do range "2"' \
  'json deno.lock "delete j.redirects[\"https://esm.sh/@supabase/supabase-js@2\"]"' \
  "ok: $imports_do_deploy imports do deploy cobertos" 'só o range em 1 (ver o aviso)'
# "Mesmo major" aceitaria os três abaixo: o range do deploy é mais estreito que o major.
checar "sem redirect, @2.110 no deploy e 2.105.4 no teste (mesmo major, fora do range): reprova" 1 \
  '"@supabase/supabase-js": o teste usa @supabase/supabase-js 2.105.4 (npm:@supabase/supabase-js@2.105.4) e o deploy, o range "2.110" (https://esm.sh/@supabase/supabase-js@2.110, sem redirect no deno.lock de deploy): sem o redirect, a versão do teste tem que estar dentro do range' \
  'json deno.json "j.imports[\"@supabase/supabase-js\"] = \"https://esm.sh/@supabase/supabase-js@2.110\"" &&
   json deno.test.json "j.imports[\"https://esm.sh/@supabase/supabase-js@2.110\"] = \"npm:@supabase/supabase-js@2.105.4\""'
checar "sem redirect, ~5.8.0 no deploy e 5.9.6 no teste (o til trava o minor): reprova" 1 \
  '"jose": o teste usa jose 5.9.6 (npm:jose@5.9.6) e o deploy, o range "~5.8.0"' \
  'json deno.json "j.imports.jose = \"https://esm.sh/jose@~5.8.0\"" &&
   json deno.test.json "j.imports[\"https://esm.sh/jose@~5.8.0\"] = \"npm:jose@5.9.6\""'
checar "sem redirect, ^0.4.2 no deploy e 0.5.0 no teste (no 0.x, o circunflexo trava o minor): reprova" 1 \
  '"zod": o teste usa zod 0.5.0 (npm:zod@0.5.0) e o deploy, o range "^0.4.2"' \
  'json deno.json "j.imports.zod = \"https://esm.sh/zod@^0.4.2\"" &&
   json deno.test.json "j.imports.zod = j.imports[\"https://esm.sh/zod@^0.4.2\"] = \"npm:zod@0.5.0\""'
checar "sem redirect, nome curto e chave-URL em versões diferentes do mesmo range: reprova" 1 \
  'a chave-URL "https://esm.sh/@supabase/supabase-js@2" e o "@supabase/supabase-js" têm que apontar para o mesmo npm:' \
  'json deno.lock "delete j.redirects[\"https://esm.sh/@supabase/supabase-js@2\"]" &&
   json deno.test.json "j.imports[\"https://esm.sh/@supabase/supabase-js@2\"] = \"npm:@supabase/supabase-js@2.106.0\""'
checar "sem deno.lock de deploy, vale o range (@2, o major): passa, com aviso" 0 \
  'AVISO: "@supabase/supabase-js": o deploy usa https://esm.sh/@supabase/supabase-js@2, sem deno.lock de deploy' \
  'rm deno.lock'
checar "deno.lock de deploy que não é JSON reprova" 1 "o deno.lock de deploy não é JSON" ': > deno.lock'
checar "redirect do deno.lock de deploy para outro pacote reprova" 1 \
  'o deno.lock de deploy redireciona https://esm.sh/@supabase/supabase-js@2 para https://esm.sh/@supabase/postgrest-js@2.105.4, que não é @supabase/supabase-js numa versão exata dentro de "2"' \
  'json deno.lock "j.redirects[\"https://esm.sh/@supabase/supabase-js@2\"] = \"https://esm.sh/@supabase/postgrest-js@2.105.4\""'
checar "redirect do deno.lock de deploy para fora do range reprova" 1 \
  'o deno.lock de deploy redireciona https://esm.sh/@supabase/supabase-js@2 para https://esm.sh/@supabase/supabase-js@3.0.0, que não é @supabase/supabase-js numa versão exata dentro de "2"' \
  'json deno.lock "j.redirects[\"https://esm.sh/@supabase/supabase-js@2\"] = \"https://esm.sh/@supabase/supabase-js@3.0.0\""'
checar "range sem redirect que a guarda não sabe ler reprova" 1 \
  'usa o range "latest", sem redirect no deno.lock de deploy, e a guarda não sabe ler esse range' \
  'json deno.json "j.imports[\"@supabase/supabase-js\"] = \"https://esm.sh/@supabase/supabase-js@latest\""'

# --- remapeamento por fora de "imports" -----------------------------------------
# Medido no Deno 2.9.8: este "scopes" carregou o jose no lugar do zod, com o lock
# congelado intacto e o import-map.test.ts verde.
checar "scopes no teste levando o zod e a URL dele para o jose reprova" 1 \
  'o deno.test.json declara "scopes", que remapeia a resolução por fora de "imports", e a guarda só confere "imports"' \
  'json deno.test.json "j.scopes = { \"./\": { zod: \"npm:jose@5.9.6\", \"https://esm.sh/zod@3.23.8\": \"npm:jose@5.9.6\" } }"'
checar "importMap, links, patch e workspace no teste reprovam" 1 \
  'o deno.test.json declara "importMap"' \
  'json deno.test.json "j.importMap = \"./im.json\"; j.links = [\"../pkg\"]; j.patch = [\"../pkg\"]; j.workspace = [\"./a\"]"' \
  'o deno.test.json declara "links"' 'o deno.test.json declara "patch"' 'o deno.test.json declara "workspace"'
checar "scopes no deploy reprova: o teste não o espelha" 1 \
  'o deno.json declara "scopes"' \
  'json deno.json "j.scopes = { \"./\": { zod: \"https://esm.sh/zod@3.24.1\" } }"'

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
checar "lock de teste que não é JSON reprova" 1 "lock de teste não é JSON" 'echo "{" > deno.test.lock'
checar "lock de teste com a entrada do esm.sh que derrubava o CI reprova" 1 \
  "o lock de teste tem 1 ocorrência(s) de https://esm.sh/" \
  'json deno.test.lock "j.remote[\"https://esm.sh/tslib@2.8.1/denonext/tslib.mjs\"] = \"c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9\""'

if [ "$falhas" -eq 0 ]; then
  echo "guarda da config de teste do edge: $casos/$casos"
else
  echo "guarda da config de teste do edge: $falhas falha(s) em $casos" >&2
fi
exit "$falhas"

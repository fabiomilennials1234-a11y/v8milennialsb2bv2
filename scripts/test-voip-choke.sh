#!/usr/bin/env bash
# =============================================================================
# test-voip-choke.sh — a barreira mecânica do choke do TorqueCalls (S10)
# =============================================================================
# O desenho do TorqueCalls sustenta uma afirmação estrutural (ADR-0024 §4):
#
#     A VPS recusa requisição sem token de escopo `call`. Token de escopo `call`
#     só existe se alguém o assinou. Se a ÚNICA função capaz de assinar for a
#     que roda o governor, contornar o governor exigiria a chave privada.
#
# Essa afirmação vale exatamente enquanto duas coisas forem verdade:
#
#   1. Nada fora de `supabase/functions/_shared/voip/` importa
#      `_shared/voip/internal/sign.ts`.
#   2. Nada além de `internal/sign.ts` lê `TORQUECALLS_SIGNING_SK`.
#
# Por que um script e não lint: `.dependency-cruiser.cjs` exclui `^supabase/`
# e `boundaries/include` do ESLint é `["src/**/*"]` — nenhuma das duas
# ferramentas enxerga `supabase/functions`. E segredo no Supabase é do PROJETO,
# então qualquer uma das 78+ funções PODE ler a variável. A barreira precisa
# existir em algum lugar; aqui é onde ela existe.
#
# O terceiro caso é o que impede este script de virar decoração: ele planta uma
# violação num diretório temporário e exige que a checagem fique VERMELHA. Um
# detector que nunca foi visto acusando não é detector.
#
# Uso:
#   bash scripts/test-voip-choke.sh
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTIONS_DIR="${REPO_ROOT}/supabase/functions"
VOIP_DIR="${FUNCTIONS_DIR}/_shared/voip"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAILED=1; }
info() { echo -e "${YELLOW}····${NC} $1"; }

FAILED=0

if [ ! -d "$VOIP_DIR" ]; then
  echo -e "${RED}FAIL${NC} $VOIP_DIR não existe — o choke sumiu do repo."
  exit 1
fi

# ---------------------------------------------------------------------------
# Detectores. Recebem o diretório a varrer para que a mesma lógica sirva à
# árvore real e à árvore com violação plantada.
# ---------------------------------------------------------------------------

# Importadores de internal/sign.ts que não estão dentro de _shared/voip/.
find_outside_importers() {
  local root="$1"
  grep -rlE "from\s+['\"][^'\"]*voip/internal/sign(\.ts)?['\"]" \
    --include='*.ts' "$root" 2>/dev/null \
    | grep -v "/_shared/voip/" || true
}

# Leitores de TORQUECALLS_SIGNING_SK fora de internal/sign.ts.
#
# Os testes DE DENTRO de _shared/voip/ instalam uma chave de brinquedo no
# ambiente e por isso citam a variável — exceção deliberada e estreita: um
# arquivo `.test.ts` em qualquer outro lugar continua sendo violação, senão
# bastaria batizar o vazamento de "teste".
find_extra_secret_readers() {
  local root="$1"
  grep -rlE "TORQUECALLS_SIGNING_SK" --include='*.ts' "$root" 2>/dev/null \
    | grep -v "/_shared/voip/internal/sign\.ts$" \
    | grep -vE "/_shared/voip/(internal/)?[a-z-]+\.test\.ts$" || true
}

# ---------------------------------------------------------------------------
# 1. Árvore real: ninguém de fora importa o assinador.
# ---------------------------------------------------------------------------
OUTSIDE="$(find_outside_importers "$FUNCTIONS_DIR")"
if [ -n "$OUTSIDE" ]; then
  fail "importam internal/sign.ts de fora de _shared/voip/:"
  echo "$OUTSIDE" | sed "s|${REPO_ROOT}/|      |"
else
  pass "só _shared/voip/ importa internal/sign.ts"
fi

# ---------------------------------------------------------------------------
# 2. Árvore real: só o assinador lê a chave privada.
# ---------------------------------------------------------------------------
READERS="$(find_extra_secret_readers "$FUNCTIONS_DIR")"
if [ -n "$READERS" ]; then
  fail "leem TORQUECALLS_SIGNING_SK fora de internal/sign.ts:"
  echo "$READERS" | sed "s|${REPO_ROOT}/|      |"
else
  pass "só internal/sign.ts lê TORQUECALLS_SIGNING_SK"
fi

# ---------------------------------------------------------------------------
# 3. Árvore real: authorizeCallAndMint é o único caller de signVoipToken.
#    Um segundo caller dentro de _shared/voip/ passaria despercebido nos dois
#    testes acima e já teria fundido o governor.
# ---------------------------------------------------------------------------
SIGN_CALLERS="$(grep -rlE "signCallToken\s*\(" --include='*.ts' "$VOIP_DIR" 2>/dev/null \
  | grep -v "/internal/sign\.ts$" | grep -v "\.test\.ts$" || true)"
EXPECTED_CALLER="${VOIP_DIR}/call-plane.ts"
if [ "$SIGN_CALLERS" != "$EXPECTED_CALLER" ]; then
  fail "signCallToken deveria ser chamado só por call-plane.ts; encontrado:"
  echo "${SIGN_CALLERS:-<nenhum>}" | sed "s|${REPO_ROOT}/|      |"
else
  pass "signCallToken só é chamado por call-plane.ts (o governor)"
fi

# ---------------------------------------------------------------------------
# 3b. A porta pública do pacote não pode vazar o minter de chamada.
#     `tokens.ts` existe para as edge functions cunharem tc-admin e tc-stream.
#     No dia em que ele reexportar signCallToken, qualquer função do projeto
#     passa a discar sem governor — e os testes acima continuariam verdes,
#     porque a chamada estaria "dentro de _shared/voip/".
# ---------------------------------------------------------------------------
# Comentários são descartados antes da busca: o próprio arquivo EXPLICA que não
# exporta o minter, e um casador de texto ingênuo acusaria a explicação.
if grep -vE '^[[:space:]]*(\*|//|/\*)' "${VOIP_DIR}/tokens.ts" 2>/dev/null | grep -q "signCallToken"; then
  fail "tokens.ts menciona signCallToken — a porta pública não pode expor o minter de chamada"
else
  pass "tokens.ts não expõe o minter de escopo call"
fi

# ---------------------------------------------------------------------------
# 3c. Lista fechada de callers do choke. Hoje: torquecalls-signal e mais nada.
#     Caller novo (nó de discagem no workflow, copilot ligando, campanha) é
#     bem-vindo — mas entra por aqui, conscientemente, não por descuido.
# ---------------------------------------------------------------------------
CHOKE_CALLERS="$(grep -rlE "authorizeCallAndMint" --include='*.ts' "$FUNCTIONS_DIR" 2>/dev/null \
  | grep -v "/_shared/voip/" | sort || true)"
EXPECTED_CHOKE_CALLERS="${FUNCTIONS_DIR}/torquecalls-signal/index.ts"
if [ "$CHOKE_CALLERS" != "$EXPECTED_CHOKE_CALLERS" ]; then
  fail "callers de authorizeCallAndMint fora da lista fechada:"
  echo "${CHOKE_CALLERS:-<nenhum>}" | sed "s|${REPO_ROOT}/|      |"
else
  pass "só torquecalls-signal chama o choke"
fi

# ---------------------------------------------------------------------------
# 4. PROVA DE QUE O DETECTOR FUNCIONA — planta as duas violações e exige que
#    cada detector as encontre. Sem esta parte o script fica verde para sempre,
#    inclusive quando parar de detectar qualquer coisa.
# ---------------------------------------------------------------------------
PLANT_DIR="$(mktemp -d)"
cleanup() { rm -rf "$PLANT_DIR"; }
trap cleanup EXIT

mkdir -p "${PLANT_DIR}/_shared/voip/internal" "${PLANT_DIR}/fn-desonesta"
cat > "${PLANT_DIR}/_shared/voip/internal/sign.ts" <<'PLANTED'
export function signVoipToken() { return Deno.env.get("TORQUECALLS_SIGNING_SK"); }
PLANTED
cat > "${PLANT_DIR}/fn-desonesta/index.ts" <<'PLANTED'
import { signVoipToken } from "../_shared/voip/internal/sign.ts";
const sk = Deno.env.get("TORQUECALLS_SIGNING_SK");
export { signVoipToken, sk };
PLANTED

PLANTED_IMPORTERS="$(find_outside_importers "$PLANT_DIR")"
if [ -z "$PLANTED_IMPORTERS" ]; then
  fail "violação plantada NÃO foi detectada: import de internal/sign.ts passou batido"
else
  pass "detector de import acusa a violação plantada"
fi

PLANTED_READERS="$(find_extra_secret_readers "$PLANT_DIR")"
if [ -z "$PLANTED_READERS" ]; then
  fail "violação plantada NÃO foi detectada: leitura de TORQUECALLS_SIGNING_SK passou batida"
else
  pass "detector de segredo acusa a violação plantada"
fi

info "violações plantadas viveram só em $PLANT_DIR (removido na saída)"

# ---------------------------------------------------------------------------
# 5. BARREIRA DE TIPO — `deno task test` roda com `--no-check`, então as
#    asserções de `_shared/voip/types.test.ts` (o Caller é opaco; org e telefone
#    não atravessam por parâmetro) só valem se alguém rodar o compilador. É aqui.
#
#    O sentido VPS → CRM (`webhook-verify.ts` e o endpoint que o consome) entrou
#    nesta lista em 2026-07-31. Antes disso os dois rodavam em CI pelos testes,
#    mas com `--no-check`: o compilador nunca os enxergava, e essa cegueira
#    deixou passar um `TypeError` (`null.trim()` em requisição sem
#    `Authorization`) onde o contrato manda 401 — a diferença entre "token ruim"
#    e "configuração quebrada", que é justamente o que o verificador existe para
#    preservar. Arquivo do voip fora do `deno check` é arquivo sem portão.
# ---------------------------------------------------------------------------
if command -v deno >/dev/null 2>&1; then
  # A saída do compilador é IMPRESSA em caso de falha. Engolir com >/dev/null
  # transformou um "lockfile v5 não suportado" (problema de versão do runner) em
  # "CHOKE DO VOIP VIOLADO" — a mensagem errada custa mais que o ruído.
  CHECK_OUT="$(cd "$FUNCTIONS_DIR" && deno check \
    _shared/voip/types.test.ts \
    _shared/voip/call-plane.ts \
    _shared/voip/caller.ts \
    _shared/voip/internal/sign.ts \
    _shared/voip/webhook-verify.ts \
    _shared/voip/webhook-verify.test.ts \
    torquecalls-webhook/index.ts \
    torquecalls-webhook/webhook-ingest.test.ts 2>&1)" && CHECK_RC=0 || CHECK_RC=$?

  if [ "$CHECK_RC" -eq 0 ]; then
    pass "barreiras de tipo do choke compilam (Caller opaco, org e peer fora do corpo)"
  else
    fail "deno check reprovou o grafo do voip:"
    echo "$CHECK_OUT" | sed 's/^/      /'
  fi
else
  info "deno ausente — barreira de tipo não exercida nesta máquina"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}CHOKE DO VOIP ÍNTEGRO${NC}"
  exit 0
else
  echo -e "${RED}CHOKE DO VOIP VIOLADO${NC}"
  exit 1
fi

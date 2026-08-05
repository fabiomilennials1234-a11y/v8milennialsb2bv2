#!/usr/bin/env bash
# Pareia uma sessão nova do TorqueCalls e mostra o QR no terminal.
#
# Por que existe: o pareamento não tem tela no CRM. As ações de sessão vivem
# só na edge function `torquecalls-control`, que exige um JWT de admin da
# organização — a VPS não aceita mais credencial auto-declarada.
#
# O `capture-qr.sh` que está na VPS NÃO funciona mais: ele manda `X-API-Key`,
# o esquema fail-open do espelho AstraCalls. O binário atual exige token
# Ed25519 assinado pelo CRM.
#
# O QR sai renderizado no stdout do container (qrterminal), então basta criar
# a sessão e seguir o log. Ele rotaciona a cada ~20s; escaneie o último.
#
# uso:  ./parear-torquecalls.sh              -> cria sessão nova e mostra o QR
#       ./parear-torquecalls.sh <tc_sid>     -> pede QR novo para sessão existente
set -euo pipefail

SUPABASE_URL="https://jsjsmuncfkbsbzqzqhfq.supabase.co"
# Chave publicável (anon). É pública por design — vai no bundle do frontend.
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzanNtdW5jZmtic2J6cXpxaGZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTg3ODEsImV4cCI6MjA4NDc5NDc4MX0.rwmZh_bLyRIluqo0KN2TsK1PR2S0TriduUOzQ_RnaKQ"
VPS="root@46.202.148.241"
CONTAINER="torquecalls-torquecalls-1"

SID_ARG="${1:-}"

# --- credencial -------------------------------------------------------------
# A senha é lida aqui, na sua máquina, e só viaja para o Supabase. Não fica em
# variável de ambiente exportada nem em arquivo.
if [ -n "${TC_ACCESS_TOKEN:-}" ]; then
  TOKEN="$TC_ACCESS_TOKEN"
  echo "usando TC_ACCESS_TOKEN do ambiente" >&2
else
  read -rp "e-mail do CRM: " EMAIL
  read -rsp "senha: " PASSWORD
  echo >&2

  TOKEN=$(
    EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -c '
import json, os, urllib.request
body = json.dumps({"email": os.environ["EMAIL"], "password": os.environ["PASSWORD"]}).encode()
req = urllib.request.Request(
    os.environ["SUPABASE_URL"] + "/auth/v1/token?grant_type=password",
    data=body,
    headers={"apikey": os.environ["ANON_KEY"], "Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print(json.load(r).get("access_token", ""))
except Exception as e:
    print("", end="")
'
  )
  unset PASSWORD
fi

if [ -z "$TOKEN" ]; then
  echo "ERRO: login falhou — e-mail ou senha incorretos." >&2
  exit 1
fi
export TOKEN SUPABASE_URL ANON_KEY

# --- sessão -----------------------------------------------------------------
call_control() {
  ACTION="$1" SID="${2:-}" python3 -c '
import json, os, sys, urllib.error, urllib.request
payload = {"action": os.environ["ACTION"]}
if os.environ.get("SID"):
    payload["tc_session_id"] = os.environ["SID"]
if os.environ["ACTION"] == "createSession":
    payload["name"] = "Milennials"
req = urllib.request.Request(
    os.environ["SUPABASE_URL"] + "/functions/v1/torquecalls-control",
    data=json.dumps(payload).encode(),
    headers={
        "apikey": os.environ["ANON_KEY"],
        "Authorization": "Bearer " + os.environ["TOKEN"],
        "Content-Type": "application/json",
    },
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print(json.dumps(json.load(r)))
except urllib.error.HTTPError as e:
    sys.stderr.write("HTTP %s: %s\n" % (e.code, e.read().decode(errors="ignore")))
    sys.exit(1)
'
}

if [ -z "$SID_ARG" ]; then
  echo "criando sessão..." >&2
  RESP=$(call_control createSession)
  SID=$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tc_session_id",""))')
  [ -n "$SID" ] || { echo "ERRO: resposta sem tc_session_id: $RESP" >&2; exit 1; }
  echo "sessão criada: $SID" >&2
else
  SID="$SID_ARG"
  echo "pedindo QR novo para $SID..." >&2
  call_control pairSession "$SID" >/dev/null
fi

# --- QR ---------------------------------------------------------------------
echo >&2
echo "================================================================" >&2
echo " Escaneie o QR abaixo em: WhatsApp > Aparelhos conectados >"
echo " Conectar aparelho. O código rotaciona — use sempre o ÚLTIMO."
echo " Ctrl-C encerra o acompanhamento (não derruba a sessão)."
echo "================================================================" >&2
echo >&2

exec ssh -t "$VPS" "docker logs -f --since 30s $CONTAINER 2>&1"

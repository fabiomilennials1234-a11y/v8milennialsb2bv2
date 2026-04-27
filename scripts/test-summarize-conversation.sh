#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:?Set SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"
AUTH="Authorization: Bearer $SERVICE_KEY"
CT="Content-Type: application/json"

PASS=0
FAIL=0
LEAD_ID=""
ORG_ID=""

cleanup() {
  echo ""
  echo "Cleaning up test data..."
  if [[ -n "$LEAD_ID" ]]; then
    curl -sf -X DELETE "$SUPABASE_URL/rest/v1/conversation_summaries?lead_id=eq.$LEAD_ID" \
      -H "$AUTH" -H "apikey: $SERVICE_KEY" || true
    curl -sf -X DELETE "$SUPABASE_URL/rest/v1/whatsapp_messages?phone_number=eq.5511999990000" \
      -H "$AUTH" -H "apikey: $SERVICE_KEY" || true
    curl -sf -X DELETE "$SUPABASE_URL/rest/v1/leads?id=eq.$LEAD_ID" \
      -H "$AUTH" -H "apikey: $SERVICE_KEY" || true
  fi
  echo ""
  echo "==========================================="
  echo "  Results: $PASS passed, $FAIL failed"
  echo "==========================================="
  if [[ $FAIL -gt 0 ]]; then exit 1; fi
}
trap cleanup EXIT

assert_ok() {
  local desc="$1" val="$2"
  if [[ -n "$val" && "$val" != "null" ]]; then
    echo "  PASS: $desc"
    ((PASS++))
  else
    echo "  FAIL: $desc (got: '$val')"
    ((FAIL++))
  fi
}

# ─── Step 1: Get an org ID ────────────────────────────────────────────────────
echo "Step 1: Getting organization ID..."
ORG_ID=$(curl -sf "$SUPABASE_URL/rest/v1/organizations?select=id&limit=1" \
  -H "$AUTH" -H "apikey: $SERVICE_KEY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "  org_id=$ORG_ID"

# ─── Step 2: Create fake lead ────────────────────────────────────────────────
echo "Step 2: Creating fake lead..."
LEAD_ID=$(curl -sf -X POST "$SUPABASE_URL/rest/v1/leads" \
  -H "$AUTH" -H "apikey: $SERVICE_KEY" -H "$CT" -H "Prefer: return=representation" \
  -d "{
    \"name\": \"__TEST_SUMMARIZE__\",
    \"phone\": \"5511999990000\",
    \"organization_id\": \"$ORG_ID\",
    \"origin\": \"test\"
  }" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "  lead_id=$LEAD_ID"

# ─── Step 3: Insert fake WhatsApp messages ───────────────────────────────────
echo "Step 3: Inserting fake messages..."
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
for i in 1 2 3 4 5; do
  MSG_CONTENT=""
  DIRECTION="incoming"
  case $i in
    1) MSG_CONTENT="Oi, vi o anuncio de voces e tenho interesse no plano empresarial" ;;
    2) MSG_CONTENT="Claro! Temos planos a partir de R\$299/mes. Qual o tamanho da sua empresa?"; DIRECTION="outgoing" ;;
    3) MSG_CONTENT="Somos 15 pessoas, mas o preco esta um pouco acima do nosso orcamento" ;;
    4) MSG_CONTENT="Entendo! Para 15 pessoas temos um desconto especial. Posso agendar uma demonstracao?"; DIRECTION="outgoing" ;;
    5) MSG_CONTENT="Sim, pode ser na quinta-feira a tarde" ;;
  esac

  curl -sf -X POST "$SUPABASE_URL/rest/v1/whatsapp_messages" \
    -H "$AUTH" -H "apikey: $SERVICE_KEY" -H "$CT" \
    -d "{
      \"organization_id\": \"$ORG_ID\",
      \"instance_id\": \"00000000-0000-0000-0000-000000000000\",
      \"message_id\": \"test_summ_$i\",
      \"remote_jid\": \"5511999990000@s.whatsapp.net\",
      \"phone_number\": \"5511999990000\",
      \"direction\": \"$DIRECTION\",
      \"message_type\": \"conversation\",
      \"content\": \"$MSG_CONTENT\",
      \"timestamp\": \"$NOW\",
      \"status\": \"received\"
    }" > /dev/null
done
echo "  5 messages inserted"

# ─── Step 4: Call edge function ───────────────────────────────────────────────
echo "Step 4: Calling summarize-conversation edge function..."
RESPONSE=$(curl -sf -X POST "$SUPABASE_URL/functions/v1/summarize-conversation" \
  -H "$AUTH" -H "$CT" \
  -d "{\"lead_id\": \"$LEAD_ID\", \"force_regenerate\": true}")

echo "  Response received"

# ─── Step 5: Validate response ───────────────────────────────────────────────
echo "Step 5: Validating response fields..."
SUMMARY=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',''))" 2>/dev/null || echo "")
SENTIMENT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sentiment',''))" 2>/dev/null || echo "")
TEMPERATURE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lead_temperature',''))" 2>/dev/null || echo "")
NEXT_ACTION=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('next_action',''))" 2>/dev/null || echo "")

assert_ok "summary is not empty" "$SUMMARY"
assert_ok "sentiment is set" "$SENTIMENT"
assert_ok "lead_temperature is set" "$TEMPERATURE"
assert_ok "next_action is set" "$NEXT_ACTION"

# ─── Step 6: Verify DB record ────────────────────────────────────────────────
echo "Step 6: Checking conversation_summaries table..."
DB_RECORD=$(curl -sf "$SUPABASE_URL/rest/v1/conversation_summaries?lead_id=eq.$LEAD_ID&select=id,summary,sentiment" \
  -H "$AUTH" -H "apikey: $SERVICE_KEY")
DB_ID=$(echo "$DB_RECORD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || echo "")
assert_ok "record saved in conversation_summaries" "$DB_ID"

echo ""
echo "Summarize conversation test complete!"

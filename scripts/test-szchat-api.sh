#!/bin/bash
# =============================================================================
# SZChat API Integration Test Script
# Tests: version, authentication, token refresh, agent info
# =============================================================================

set -euo pipefail

API_URL="https://alamaster.sz.chat/api/v4"
EMAIL="api.fortics@alamaster.com.br"
PASSWORD="ubvS1VNUijEA"
CHANNEL_ID="685c0a87e083650018315d40"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo "========================================="
echo "  SZChat API Integration Tests"
echo "  Target: $API_URL"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Test 1: API Version (no auth required)
# ---------------------------------------------------------------------------
info "Test 1: GET /api/version (no auth)"
VERSION_RES=$(curl -s -w "\n%{http_code}" "$API_URL/../version" 2>/dev/null || true)
VERSION_CODE=$(echo "$VERSION_RES" | tail -1)
VERSION_BODY=$(echo "$VERSION_RES" | sed '$d')

if [ "$VERSION_CODE" = "200" ]; then
  pass "API version endpoint reachable (HTTP $VERSION_CODE)"
  echo "     Response: $VERSION_BODY"
else
  warn "Version endpoint returned HTTP $VERSION_CODE (may not exist at this path)"
  # Try alternative path
  VERSION_RES2=$(curl -s -w "\n%{http_code}" "https://alamaster.sz.chat/api/version" 2>/dev/null || true)
  VERSION_CODE2=$(echo "$VERSION_RES2" | tail -1)
  if [ "$VERSION_CODE2" = "200" ]; then
    pass "API version at /api/version (HTTP $VERSION_CODE2)"
  else
    warn "Version endpoint not available (non-blocking)"
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# Test 2: Authentication - Login
# ---------------------------------------------------------------------------
info "Test 2: POST /auth/login"
LOGIN_RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>/dev/null)

LOGIN_CODE=$(echo "$LOGIN_RES" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RES" | sed '$d')

if [ "$LOGIN_CODE" = "200" ]; then
  pass "Login successful (HTTP $LOGIN_CODE)"

  # Extract token
  TOKEN=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)

  if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
    pass "JWT token received (${#TOKEN} chars)"
    echo "     Token prefix: ${TOKEN:0:30}..."

    # Extract agent info
    AGENT_NAME=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; u=json.load(sys.stdin).get('user',{}); print(u.get('name','?'))" 2>/dev/null || echo "?")
    AGENT_TYPE=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; u=json.load(sys.stdin).get('user',{}); print(u.get('type','?'))" 2>/dev/null || echo "?")
    AGENT_ID=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; u=json.load(sys.stdin).get('user',{}); print(u.get('_id','?'))" 2>/dev/null || echo "?")

    echo "     Agent: $AGENT_NAME (type: $AGENT_TYPE, id: $AGENT_ID)"
  else
    fail "Login returned 200 but no token found"
    echo "     Body: $LOGIN_BODY"
    exit 1
  fi
else
  fail "Login failed (HTTP $LOGIN_CODE)"
  echo "     Body: $LOGIN_BODY"
  exit 1
fi
echo ""

# ---------------------------------------------------------------------------
# Test 3: Token Refresh
# ---------------------------------------------------------------------------
info "Test 3: GET /auth/refresh"
REFRESH_RES=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/auth/refresh" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" 2>/dev/null)

REFRESH_CODE=$(echo "$REFRESH_RES" | tail -1)
REFRESH_BODY=$(echo "$REFRESH_RES" | sed '$d')

if [ "$REFRESH_CODE" = "200" ]; then
  NEW_TOKEN=$(echo "$REFRESH_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
  if [ -n "$NEW_TOKEN" ] && [ "$NEW_TOKEN" != "" ]; then
    pass "Token refresh successful, new token received"
    TOKEN="$NEW_TOKEN"
  else
    pass "Token refresh returned 200 (token may be in different format)"
  fi
else
  fail "Token refresh failed (HTTP $REFRESH_CODE)"
  echo "     Body: $REFRESH_BODY"
fi
echo ""

# ---------------------------------------------------------------------------
# Test 4: Get Agent Info (auth/me)
# ---------------------------------------------------------------------------
info "Test 4: GET /auth/me"
ME_RES=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/auth/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" 2>/dev/null)

ME_CODE=$(echo "$ME_RES" | tail -1)
ME_BODY=$(echo "$ME_RES" | sed '$d')

if [ "$ME_CODE" = "200" ]; then
  pass "Agent info retrieved (HTTP $ME_CODE)"
  # Pretty print key fields
  echo "$ME_BODY" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    user = data if '_id' in data else data.get('user', data)
    print(f\"     Name: {user.get('name', '?')}\")
    print(f\"     Email: {user.get('email', '?')}\")
    print(f\"     Type: {user.get('type', '?')}\")
    print(f\"     ID: {user.get('_id', '?')}\")
    teams = user.get('teams', user.get('attendance_ids', []))
    if teams:
        print(f\"     Teams: {json.dumps(teams, indent=6)}\")
except:
    print(f\"     Raw: {sys.stdin.read()[:200]}\")
" 2>/dev/null || echo "     Raw: ${ME_BODY:0:200}"
else
  warn "Agent info endpoint returned HTTP $ME_CODE"
  echo "     Body: ${ME_BODY:0:200}"
fi
echo ""

# ---------------------------------------------------------------------------
# Test 5: Validate Channel ID
# ---------------------------------------------------------------------------
info "Test 5: Validate Channel ID ($CHANNEL_ID)"

# Try to get channels list
CHANNELS_RES=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" 2>/dev/null)

CHANNELS_CODE=$(echo "$CHANNELS_RES" | tail -1)
CHANNELS_BODY=$(echo "$CHANNELS_RES" | sed '$d')

if [ "$CHANNELS_CODE" = "200" ]; then
  pass "Channels endpoint reachable (HTTP $CHANNELS_CODE)"
  echo "$CHANNELS_BODY" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    channels = data if isinstance(data, list) else data.get('data', data.get('channels', []))
    if isinstance(channels, list):
        print(f\"     Total channels: {len(channels)}\")
        for ch in channels:
            ch_id = ch.get('_id', '?')
            ch_name = ch.get('name', ch.get('label', '?'))
            ch_type = ch.get('type', ch.get('platform', '?'))
            marker = ' <-- TARGET' if ch_id == '$CHANNEL_ID' else ''
            print(f\"     - {ch_name} ({ch_type}) ID: {ch_id}{marker}\")
    else:
        print(f\"     Response: {str(data)[:300]}\")
except Exception as e:
    print(f\"     Parse error: {e}\")
    print(f\"     Raw: {sys.stdin.read()[:300]}\")
" 2>/dev/null || echo "     Raw: ${CHANNELS_BODY:0:300}"
else
  warn "Channels endpoint returned HTTP $CHANNELS_CODE"
fi
echo ""

# ---------------------------------------------------------------------------
# Test 6: List Teams
# ---------------------------------------------------------------------------
info "Test 6: GET /teams (validate team IDs)"

TEAMS_RES=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/teams" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" 2>/dev/null)

TEAMS_CODE=$(echo "$TEAMS_RES" | tail -1)
TEAMS_BODY=$(echo "$TEAMS_RES" | sed '$d')

EXPECTED_TEAMS="684055a43256d310cf01a4c0 683ddc5a3db127655c004b7d 6840505c2490a264a809de45 684057373e74ddda9a0a379f 684052712f2482e6d70fd833 6877b5772aeac5a9bc06e447"

if [ "$TEAMS_CODE" = "200" ]; then
  pass "Teams endpoint reachable (HTTP $TEAMS_CODE)"
  echo "$TEAMS_BODY" | python3 -c "
import sys, json
expected = set('$EXPECTED_TEAMS'.split())
try:
    data = json.load(sys.stdin)
    teams = data if isinstance(data, list) else data.get('data', data.get('teams', []))
    if isinstance(teams, list):
        print(f\"     Total teams: {len(teams)}\")
        found = set()
        for t in teams:
            t_id = t.get('_id', '?')
            t_name = t.get('name', '?')
            match = t_id in expected
            if match: found.add(t_id)
            marker = ' <-- MATCH' if match else ''
            print(f\"     - {t_name}: {t_id}{marker}\")
        missing = expected - found
        if not missing:
            print(f\"     All {len(expected)} expected teams found!\")
        else:
            print(f\"     WARNING: {len(missing)} team(s) not found: {missing}\")
    else:
        print(f\"     Response type: {type(data).__name__}: {str(data)[:300]}\")
except Exception as e:
    print(f\"     Parse error: {e}\")
" 2>/dev/null || echo "     Raw: ${TEAMS_BODY:0:500}"
else
  warn "Teams endpoint returned HTTP $TEAMS_CODE"
  echo "     Body: ${TEAMS_BODY:0:200}"
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Test Summary"
echo "========================================="
echo ""
info "API URL:    $API_URL"
info "Agent:      $EMAIL"
info "Channel:    $CHANNEL_ID"
info "Token OK:   $([ -n "$TOKEN" ] && echo 'Yes' || echo 'No')"
echo ""
echo "Next steps:"
echo "  1. Set Supabase secrets (SZ_CHAT_AGENT_EMAIL, SZ_CHAT_AGENT_PASSWORD)"
echo "  2. Insert sz_chat_config row in database"
echo "  3. Configure webhook URL in SZChat admin panel"
echo ""

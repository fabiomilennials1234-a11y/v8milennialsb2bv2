#!/usr/bin/env bash
# =============================================================================
# test-secret-scan.sh — TDD harness for SAST + secret-scanning CI (issue #653)
# =============================================================================
# Proves, end to end, that the security CI we ship actually works:
#
#   1. gitleaks (with our .gitleaks.toml) FLAGS a planted fake Supabase
#      service_role JWT in a scratch file.                          [catches]
#   2. gitleaks FLAGS a planted fake Supabase `sbp_` personal access token.
#   3. gitleaks FLAGS a planted generic high-entropy secret.
#   4. gitleaks does NOT flag the committed example files (.env.example etc.)
#      nor the well-known Supabase local demo JWTs baked into CI.   [allowlist]
#   5. Every workflow YAML under .github/workflows parses cleanly.
#
# The planted secrets live only in a throwaway temp dir that is removed on
# exit, so this script never writes a real-looking secret into the repo tree.
#
# Usage:
#   bash scripts/test-secret-scan.sh
#
# Requirements: gitleaks (https://github.com/gitleaks/gitleaks), python3 (PyYAML).
# Skips gracefully (exit 0 with SKIP notice) if gitleaks is unavailable so it
# never wedges a machine that lacks the binary; CI installs gitleaks first.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${REPO_ROOT}/.gitleaks.toml"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAILED=1; }
info() { echo -e "${YELLOW}····${NC} $1"; }

FAILED=0

# --- preconditions ----------------------------------------------------------
if ! command -v gitleaks >/dev/null 2>&1; then
  echo -e "${YELLOW}SKIP${NC} gitleaks not installed — install it to run this harness."
  echo "      brew install gitleaks   # or see https://github.com/gitleaks/gitleaks"
  exit 0
fi

if [ ! -f "$CONFIG" ]; then
  fail "missing config: $CONFIG"
  echo -e "${RED}Cannot run secret-scan tests without .gitleaks.toml${NC}"
  exit 1
fi

GITLEAKS_VERSION="$(gitleaks version 2>/dev/null || echo '?')"
info "gitleaks ${GITLEAKS_VERSION}, config ${CONFIG}"

# Scratch sandbox that never lands in the repo.
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# scan_dir <path> -> prints number of findings, returns gitleaks exit code semantics
# We use --no-git so a plain directory (not a git repo) is scanned, and a JSON
# report so we can count findings deterministically.
scan() {
  local target="$1" report="$2"
  gitleaks detect \
    --no-git \
    --source "$target" \
    --config "$CONFIG" \
    --report-format json \
    --report-path "$report" \
    --no-banner \
    --exit-code 7 \
    >/dev/null 2>&1 || true
}

count_findings() {
  local report="$1"
  if [ ! -s "$report" ]; then echo 0; return; fi
  python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$report" 2>/dev/null || echo 0
}

# --- Test 1: service_role JWT is caught -------------------------------------
# Fake Supabase service_role JWT, ASSEMBLED AT RUNTIME so this committed file
# contains no literal token (passes GitHub push protection). The harness writes
# the assembled token to a scratch file and scans THAT, so detection is unchanged.
b64url() { printf '%s' "$1" | base64 | tr -d '=' | tr '/+' '_-'; }
FAKE_SERVICE_JWT="$(b64url '{"alg":"HS256","typ":"JWT"}').$(b64url '{"role":"service_role","iss":"fake-project","iat":1700000000}').$(b64url 'fakesignature_not_a_real_key_at_all')"
mkdir -p "$SCRATCH/t1"
printf 'const KEY = "%s";\n' "$FAKE_SERVICE_JWT" > "$SCRATCH/t1/leak.ts"
scan "$SCRATCH/t1" "$SCRATCH/r1.json"
n1="$(count_findings "$SCRATCH/r1.json")"
if [ "$n1" -ge 1 ]; then pass "service_role JWT flagged ($n1 finding/s)"; else
  fail "service_role JWT NOT flagged — rule missing/broken"; fi

# --- Test 2: sbp_ personal access token is caught ---------------------------
# Assembled at runtime (no literal sbp_ token committed -> passes push protection).
FAKE_SBP_PAT="sbp_$(printf '0123456789abcdef0123456789abcdef01234567')"
mkdir -p "$SCRATCH/t2"
printf 'SUPABASE_ACCESS_TOKEN=%s\n' "$FAKE_SBP_PAT" > "$SCRATCH/t2/leak.env.real"
scan "$SCRATCH/t2" "$SCRATCH/r2.json"
n2="$(count_findings "$SCRATCH/r2.json")"
if [ "$n2" -ge 1 ]; then pass "sbp_ PAT flagged ($n2 finding/s)"; else
  fail "sbp_ PAT NOT flagged — rule missing/broken"; fi

# --- Test 3: generic high-entropy secret is caught --------------------------
mkdir -p "$SCRATCH/t3"
printf 'api_key = "%s"\n' "Hq8vZ2pLrT5nW9xK3mB7yC1dF4gJ6sA0eR8uI2oN5tQ" > "$SCRATCH/t3/conf.py"
scan "$SCRATCH/t3" "$SCRATCH/r3.json"
n3="$(count_findings "$SCRATCH/r3.json")"
if [ "$n3" -ge 1 ]; then pass "generic high-entropy secret flagged ($n3 finding/s)"; else
  fail "generic high-entropy secret NOT flagged"; fi

# --- Test 4: committed example/CI files are NOT flagged ----------------------
# Scan the real repo's allowlisted surfaces. .env.example documents fake values;
# the test workflow embeds the public Supabase local demo JWTs. Neither is a leak.
ALLOWLISTED=(
  "${REPO_ROOT}/.env.example"
  "${REPO_ROOT}/.env.local.example"
  "${REPO_ROOT}/.env.e2e.example"
  "${REPO_ROOT}/.github/workflows/test.yml"
)
mkdir -p "$SCRATCH/t4"
for f in "${ALLOWLISTED[@]}"; do
  [ -f "$f" ] && cp "$f" "$SCRATCH/t4/$(basename "$f")"
done
# Run gitleaks against the actual repo path so allowlist path-globs match.
gitleaks detect \
  --no-git \
  --source "$REPO_ROOT" \
  --config "$CONFIG" \
  --report-format json \
  --report-path "$SCRATCH/r4.json" \
  --no-banner \
  >/dev/null 2>&1 || true
# Collect any findings whose file is one of the allowlisted example/CI files.
LEAKS_IN_EXAMPLES="$(python3 - "$SCRATCH/r4.json" <<'PY'
import json, sys, os
path = sys.argv[1]
try:
    data = json.load(open(path))
except Exception:
    data = []
needles = (".env.example", ".env.local.example", ".env.e2e.example",
           os.path.join(".github", "workflows", "test.yml"))
hits = [d.get("File", "") for d in data
        if any(d.get("File", "").endswith(n) for n in needles)]
print("\n".join(hits))
PY
)"
if [ -z "$LEAKS_IN_EXAMPLES" ]; then
  pass "example/CI files NOT flagged (allowlist works)"
else
  fail "example/CI files WERE flagged — allowlist too narrow:"
  echo "$LEAKS_IN_EXAMPLES" | sed 's/^/        /'
fi

# --- Test 5: full tracked tree scans clean ----------------------------------
# After fixing the one real historical leak (the SZ.Chat credential, now read
# from env in scripts/test-szchat-api.sh), the whole tree must scan clean so the
# gitleaks CI is green on its first run. Every remaining match is fake test data
# or a public-by-design anon JWT, all covered by the allowlist.
gitleaks detect \
  --no-git \
  --source "$REPO_ROOT" \
  --config "$CONFIG" \
  --report-format json \
  --report-path "$SCRATCH/r5.json" \
  --no-banner \
  --log-level error \
  >/dev/null 2>&1 || true
UNEXPECTED="$(python3 - "$SCRATCH/r5.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    data = []
bad = [f"{d.get('RuleID')}  {d.get('File')}:{d.get('StartLine')}" for d in data]
print("\n".join(bad))
PY
)"
if [ -z "$UNEXPECTED" ]; then
  pass "tracked tree scans clean (CI green on first run)"
else
  fail "unexpected findings in tracked tree (real leak or allowlist gap):"
  echo "$UNEXPECTED" | sed 's/^/        /'
fi

# --- Test 6: the old SZ.Chat credential is gone from the script --------------
# Regression guard: the real password must never be reintroduced.
if grep -q 'ubvS1VNUijEA' "${REPO_ROOT}/scripts/test-szchat-api.sh" 2>/dev/null; then
  fail "hardcoded SZ.Chat password reintroduced in scripts/test-szchat-api.sh"
else
  pass "SZ.Chat script reads credentials from env (no hardcoded secret)"
fi

# --- Test 7: every workflow YAML parses -------------------------------------
YAML_OK=1
while IFS= read -r -d '' wf; do
  if python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$wf" 2>/dev/null; then
    info "yaml ok: ${wf#"$REPO_ROOT"/}"
  else
    YAML_OK=0
    fail "yaml INVALID: ${wf#"$REPO_ROOT"/}"
  fi
done < <(find "${REPO_ROOT}/.github/workflows" -maxdepth 1 -name '*.yml' -print0)
[ "$YAML_OK" -eq 1 ] && pass "all workflow YAML well-formed"

# --- summary ----------------------------------------------------------------
echo ""
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}ALL SECRET-SCAN TESTS PASSED${NC}"
  exit 0
else
  echo -e "${RED}SECRET-SCAN TESTS FAILED${NC}"
  exit 1
fi

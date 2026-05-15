# Torque CRM — Security Audit Report

**Date:** 2026-05-15  
**Scope:** Full-stack cybersecurity analysis (external recon + codebase audit)  
**Target:** torquecrm.com.br + codebase  
**Authorized by:** Gabriel (CTO/Owner)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| **CRITICAL** | 4 |
| **HIGH** | 8 |
| **MEDIUM** | 6 |
| **LOW** | 4 |
| **Total** | 22 |

The system has solid foundational security (Docker non-root, HTTPS, RLS framework, timing-safe compare utility exists). However, critical issues remain in multi-tenant isolation, permission engine defaults, nginx header delivery, and inconsistent secret comparison patterns.

---

## CRITICAL Findings

### C1. Permission Engine Defaults to `allowed: true`

**File:** `supabase/functions/_shared/permission_engine.ts:160`  
**Confidence:** 10/10

```typescript
// 8. Fallback: consultar feature_permissions.default_value
return { allowed: true, reason: "fallback_allowed" };
```

**Impact:** Any action not explicitly mapped in `ACTION_TO_FEATURE` or `ACTION_TO_MATRIX` is auto-allowed. New features added without permission mapping = open to all members by default.

**Exploit:** Add a new action type to the system. If it doesn't match any cascade check, the fallback grants access unconditionally. This is a fail-open design.

**Fix:**
```typescript
return { allowed: false, reason: "permission_not_defined" };
```

---

### C2. `link_agent_to_instance()` — No Organization Validation (SECURITY DEFINER)

**File:** `supabase/migrations/20260125000002_link_agent_to_whatsapp_instance.sql:98-131`  
**Confidence:** 9/10

```sql
CREATE OR REPLACE FUNCTION public.link_agent_to_instance(
  p_agent_id UUID, p_instance_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE public.copilot_agents SET whatsapp_instance_id = NULL WHERE whatsapp_instance_id = p_instance_id;
  UPDATE public.whatsapp_instances SET copilot_agent_id = NULL WHERE copilot_agent_id = p_agent_id;
  UPDATE public.copilot_agents SET whatsapp_instance_id = p_instance_id WHERE id = p_agent_id;
  UPDATE public.whatsapp_instances SET copilot_agent_id = p_agent_id WHERE id = p_instance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Impact:** SECURITY DEFINER bypasses RLS. Any authenticated user can bind ANY agent to ANY WhatsApp instance across organizations. Attacker could hijack another org's WhatsApp channel.

**Fix:** Add organization ownership check:
```sql
-- Verify both resources belong to the same org as the calling user
IF NOT EXISTS (
  SELECT 1 FROM copilot_agents ca
  JOIN whatsapp_instances wi ON wi.organization_id = ca.organization_id
  WHERE ca.id = p_agent_id AND wi.id = p_instance_id
  AND ca.organization_id = get_user_organization_id()
) THEN
  RAISE EXCEPTION 'Cross-tenant operation denied';
END IF;
```

---

### C3. Nginx Header Inheritance Bug — HSTS/CSP Not Served on SPA Routes

**File:** `Dockerfile:76-79`  
**Confidence:** 10/10 (verified via external recon)

```nginx
location / {
    add_header Cache-Control "no-store, must-revalidate" always;
    try_files $uri $uri/ /index.html;
}
```

**Impact:** The SPA catch-all `location /` block uses `add_header`, which **overrides ALL parent server-block headers** per nginx behavior. Result: HSTS, CSP, Referrer-Policy, X-XSS-Protection are NOT served on any SPA route. Only the root `/` and `/index.html` exact-match blocks partially re-add headers.

**Verified externally:** `curl -sI https://torquecrm.com.br/leads` returns response WITHOUT HSTS or CSP headers.

**Fix:** Repeat all security headers in every location block, or use an `include` directive:
```nginx
# Create /etc/nginx/security-headers.conf with all headers
# Then in each location block:
include /etc/nginx/security-headers.conf;
```

---

### C4. CORS Defaults to `*` When ALLOWED_ORIGINS Not Set

**File:** `supabase/functions/_shared/cors.ts:13`  
**Confidence:** 9/10

```typescript
let corsOrigin = "*";
```

**Impact:** If `ALLOWED_ORIGINS` env var is not configured in Supabase, ALL edge functions accept cross-origin requests from ANY domain. Combined with cookie/token-based auth, this enables CSRF attacks from malicious websites.

**Fix:**
```typescript
let corsOrigin = ""; // fail-closed
if (!allowedOrigins) {
  console.error("ALLOWED_ORIGINS not configured — CORS blocked");
  return { "Access-Control-Allow-Origin": "null" };
}
```

---

## HIGH Findings

### H1. Service Role Key Validated with `.includes()` — 4 Functions

**Files:**
- `whatsapp-health-monitor/index.ts:111`
- `whatsapp-session-watchdog/index.ts:94`
- `whatsapp-rebind-webhook/index.ts:223`
- `whatsapp-dlq-replay/index.ts:147`

```typescript
(!!SUPABASE_SERVICE_ROLE_KEY && authHeader.includes(SUPABASE_SERVICE_ROLE_KEY))
```

**Impact:** `.includes()` accepts substring matches — `Authorization: garbage<KEY>garbage` authenticates. Also timing-vulnerable. The `timingSafeCompare()` utility already exists in `_shared/auth.ts` but isn't used here.

**Fix:**
```typescript
const token = authHeader?.replace("Bearer ", "");
timingSafeCompare(token || "", SUPABASE_SERVICE_ROLE_KEY)
```

---

### H2. CRON_SECRET Compared with `===` — 4 Functions

**Files:**
- `whatsapp-health-monitor/index.ts:110`
- `whatsapp-session-watchdog/index.ts:93`
- `whatsapp-rebind-webhook/index.ts:222`
- `refresh-meta-tokens/index.ts:24`

```typescript
cronSecret === CRON_SECRET
```

**Impact:** Timing-vulnerable. Attacker can measure response time differences to brute-force the CRON_SECRET character by character.

**Fix:** Use `timingSafeCompare(cronSecret, CRON_SECRET)` (already available in `_shared/auth.ts`).

---

### H3. DOMPurify Config Allows `style` Attribute in Email Renderer

**File:** `src/components/email/EmailThreadView.tsx:118-128`  
**Confidence:** 8/10

```typescript
ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'style', 'target', 'width', 'height', ...]
```

**Impact:** `style` attribute enables CSS injection (data exfiltration via `background-image: url()`). `img` with `src` enables tracking pixels and potential CSRF. Email content is external/untrusted input.

**Fix:** Remove `style` and `class` from ALLOWED_ATTR. Restrict `img src` to data: URIs or specific domains. Add `ALLOW_UNKNOWN_PROTOCOLS: false`.

---

### H4. `is_team_member()` Still Has No Organization Scope

**File:** `supabase/migrations/20260107182240_...sql`  
**Confidence:** 7/10

The function checks if a user exists in team_members OR user_roles globally — no org filter. **However**, the security fix migration (20260130000000) replaced most critical RLS policies to use `get_user_organization_id()` instead. The `is_team_member()` policies on leads, pipes, etc. were dropped and replaced.

**Remaining risk:** New tables added AFTER the fix that use `is_team_member()` without org scope (e.g., `products` table in migration 20260706000000). Each new migration must use `get_user_organization_id()`, not `is_team_member()`.

**Fix:** Either:
1. Drop `is_team_member()` entirely and audit all references
2. Add org parameter: `is_team_member(_user_id, _org_id)`

---

### H5. 63 Edge Functions with `verify_jwt = false`

**File:** `supabase/config.toml`  
**Confidence:** 8/10

63 functions disable Supabase JWT verification. Most have internal auth (CRON_SECRET, webhook secrets, internal API key), but some lack documented auth:

- `test-gemini-rag` — test function in production
- `calculate-lead-score` — scoring engine
- `summarize-conversation` — AI summary

**Fix:**
1. Delete test functions from production config
2. Audit each function's internal auth mechanism
3. Document auth strategy per function

---

### H6. No WAF/CDN — Origin IP Directly Exposed

**Infrastructure:** `46.202.148.241` (Hostinger VPS, Sao Paulo)  
**Confidence:** 9/10

No Cloudflare/WAF layer. Origin server directly accessible. No DDoS protection beyond what Hostinger provides.

**Fix:** Front with Cloudflare (free tier minimum). Provides WAF, DDoS mitigation, hides origin IP.

---

### H7. Server Version Disclosure

**Infrastructure:** Response header `server: nginx/1.31.0`  
**Confidence:** 9/10

Aids targeted exploit selection.

**Fix:** Add `server_tokens off;` to nginx server block in Dockerfile.

---

### H8. Meta Webhook GET Verification Not Timing-Safe

**File:** `supabase/functions/meta-webhook/index.ts:37`

```typescript
if (mode === "subscribe" && token === META_WEBHOOK_VERIFY_TOKEN)
```

**Fix:** Use `timingSafeCompare()`.

---

## MEDIUM Findings

### M1. CSP Allows `unsafe-inline` + `unsafe-eval`

**File:** `Dockerfile:59` and `index.html` meta tag  
**Impact:** Significantly weakens XSS protection. `unsafe-eval` needed by some libs but should be audited and ideally removed.

### M2. localStorage for Auth Tokens

**File:** `src/integrations/supabase/client.ts:12-14`  
**Impact:** If XSS exists, tokens extractable from localStorage. Standard Supabase pattern, but httpOnly cookies are more secure.

### M3. File Upload Accepts Any Image MIME

**File:** `src/components/settings/ProfileSettings.tsx:43-55`  
**Impact:** Only checks `file.type.startsWith("image/")`. Extension not validated separately. Supabase Storage mitigates path traversal, but should validate extension whitelist.

### M4. SPA Returns 200 for Sensitive Paths

**Infrastructure:** `/.env`, `/.git/config` return 200 (SPA fallback, not actual files)  
**Fix:** Add `location ~ /\. { return 404; }` to nginx config.

### M5. Missing `Permissions-Policy` Header

**Infrastructure:** Browser feature access (camera, geolocation, microphone) not restricted.  
**Fix:** Add `Permissions-Policy: camera=(), microphone=(), geolocation=()` header.

### M6. Chart Component CSS Injection via `dangerouslySetInnerHTML`

**File:** `src/components/ui/chart.tsx:79`  
**Impact:** Low risk if chart config comes from trusted sources. Validate color values with regex if user-sourced.

---

## LOW Findings

### L1. Let's Encrypt Certificate Expires 2026-07-19
Ensure auto-renewal is configured. 65 days remaining.

### L2. No `security.txt` at `/.well-known/security.txt`
Best practice for vulnerability disclosure program.

### L3. Admin SQL Scripts in Repository
`FORCAR_VINCULO_ORGANIZACAO.sql`, `scripts/insert-master-user.sql` — privileged operations. Move to gitignored directory.

### L4. Internal API Key Uses `===` Comparison
**File:** `supabase/functions/_shared/user-auth.ts:109`

---

## Remediation Priority

### Immediate (Today)
1. **C1** — Change permission engine fallback to `allowed: false`
2. **C3** — Fix nginx header inheritance (all security headers in all location blocks)
3. **H1** — Replace `.includes()` with proper Bearer extraction + `timingSafeCompare()`
4. **H2** — Replace `===` with `timingSafeCompare()` for CRON_SECRET

### This Week
5. **C2** — Add org validation to `link_agent_to_instance()` / `unlink_agent_from_instance()`
6. **C4** — Change CORS default to fail-closed
7. **H3** — Tighten DOMPurify config in EmailThreadView
8. **H5** — Remove test functions from production, audit no-JWT functions
9. **H7** — Add `server_tokens off;`

### This Sprint
10. **H4** — Audit and replace remaining `is_team_member()` usages
11. **H6** — Deploy Cloudflare in front of VPS
12. **M1** — Audit `unsafe-eval` dependencies, remove if possible
13. **M4** — Block dotfile paths in nginx

---

## Positive Findings

- TLS 1.3 with strong cipher suite
- HTTP to HTTPS redirect (308)
- Docker runs as non-root user (`nginx`)
- `timingSafeCompare()` utility exists and is used in newer functions
- Service role key NOT exposed in frontend bundle
- RLS framework with `get_user_organization_id()` in critical tables (post-security fix)
- Webhook delivery uses HMAC signing
- Meta webhook POST correctly validates HMAC-SHA256 signatures
- WhatsApp webhook uses timing-safe secret validation
- Rate limiting implemented with persistent checks
- `.env` properly gitignored (not committed to repository)

-- ============================================================================
-- 20260722135748_password_reset_tokens.sql
--
-- (Ex-20270107000000, renumerado na faxina A2 — 2026-07-22 — pra resolver a
--  colisão de prefixo com 3 outras migrations. SQL idêntico; nunca havia sido
--  aplicado em prod → forgot/reset-password quebrados.
--  ✅ APLICADO EM PROD via apply_migration em 2026-07-22, gravado no ledger
--  sob esta versão (20260722135748). Arquivo alinhado ao ledger.
--  ⚠️ DEV (bcfadphgsibjzivtbjvc) inacessível via MCP → aplicar via CLI:
--     psql "$DEV_DB_URL" -f este_arquivo
--     supabase migration repair --status applied 20260722135748 --project-ref bcfadphgsibjzivtbjvc)
--
-- Self-hosted "esqueci minha senha" (password reset) infrastructure.
--
-- WHY: the previous flow leaned on Supabase Auth's mailer + PKCE recovery link.
-- That path is fragile in practice (email not delivered, broken redirect, PKCE
-- fails cross-device, and email security scanners consume the one-time link
-- before the human clicks it). Decision (CTO-approved) is to own the whole
-- flow: our own token, our own email (Resend), our own reset page. Modeled on
-- RallyAPI's NestJS/Prisma reset flow.
--
-- Two edge functions drive this, both using the service_role client (which
-- bypasses RLS):
--   forgot-password → mints a token, stores ONLY its SHA-256 hash, emails link
--   reset-password  → validates the hash, swaps the password, consumes the token
--
-- This migration ships:
--   1. public.password_reset_tokens  — hash-only token store (RLS deny-all)
--   2. public.auth_rate_limits       — per-(ip,endpoint) fixed-window counter (RLS deny-all)
--   3. public.check_auth_rate_limit  — atomic increment-and-check (SECURITY DEFINER)
--   4. public.claim_password_reset_token — atomic single-use consume (SECURITY DEFINER)
--
-- SECURITY NOTES
--   * Neither table carries organization_id: these are auth-level artifacts keyed
--     to auth.users, not tenant data. Isolation is by deny-all RLS + no grants to
--     anon/authenticated — ONLY service_role (which bypasses RLS) ever touches them.
--   * The raw token is NEVER stored — only its SHA-256 hex. A DB-only leak yields
--     hashes of high-entropy (256-bit) tokens, which are not reversible/guessable.
--   * SECURITY DEFINER functions pin search_path per ADR-2026-06-23
--     (definer-search-path-hardening): `public, extensions`, NEVER '' (empty broke
--     leads_uf), so name resolution is deterministic regardless of the caller.
--
-- APLICAR dev → prod com aval explícito do CTO (regra do projeto). Não aplicado
-- automaticamente por esta slice.
-- ============================================================================

-- ============================================================================
-- 1. password_reset_tokens — hash-only, single-use, short-lived
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SHA-256 hex of the raw token. The raw token is display-once (emailed) and
  -- never persisted. No salt needed: the token is already 256-bit high-entropy.
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Point lookup on the hash (the hot path of reset-password / claim RPC).
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
  ON public.password_reset_tokens (token_hash);

-- Used by forgot-password to invalidate a user's prior unused tokens.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON public.password_reset_tokens (user_id);

-- RLS deny-all. There are intentionally NO policies and NO grants to
-- anon/authenticated: this table is only ever read/written by the
-- forgot-password / reset-password edge functions via the service_role client,
-- which bypasses RLS entirely. Any anon/authenticated access must be denied.
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_tokens FROM anon, authenticated;

COMMENT ON TABLE public.password_reset_tokens IS
  'Self-hosted password reset tokens (hash-only). RLS deny-all by design: no '
  'policies, no anon/authenticated grants — only service_role (RLS bypass) via '
  'the forgot-password/reset-password edge functions. Raw token never stored.';

-- ============================================================================
-- 2. auth_rate_limits — per-(ip,endpoint) fixed-window request counter
-- ============================================================================
-- Chosen over the in-memory rate limiter of whatsapp-api-proxy (which is
-- per-org and resets on cold start / does not span isolates) because auth
-- endpoints are anonymous, per-IP, and must survive isolate churn. One row per
-- (ip, endpoint); the window resets when it elapses. RLS deny-all, same as above.
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip            text NOT NULL,
  endpoint      text NOT NULL,
  window_start  timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ip, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_ip_endpoint
  ON public.auth_rate_limits (ip, endpoint);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_rate_limits FROM anon, authenticated;

COMMENT ON TABLE public.auth_rate_limits IS
  'Per-(ip,endpoint) fixed-window rate-limit counter for anonymous auth edge '
  'functions. RLS deny-all: only service_role via check_auth_rate_limit().';

-- ============================================================================
-- 3. check_auth_rate_limit — atomic increment-and-check
-- ============================================================================
-- Returns TRUE while the caller is within limit, FALSE once it exceeds p_max
-- inside the current p_window. Atomic: the INSERT ... ON CONFLICT DO UPDATE
-- takes a row lock so concurrent calls serialize on (ip, endpoint) and each
-- observes a consistent count. Fixed window: when the stored window has
-- elapsed, the count resets to 1 and the window restarts.
CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(
  p_ip       text,
  p_endpoint text,
  p_max      integer,
  p_window   interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ip    text := COALESCE(NULLIF(btrim(p_ip), ''), 'unknown');
  v_count integer;
BEGIN
  INSERT INTO public.auth_rate_limits AS arl (ip, endpoint, window_start, request_count)
  VALUES (v_ip, p_endpoint, now(), 1)
  ON CONFLICT (ip, endpoint) DO UPDATE
    SET
      request_count = CASE
        WHEN arl.window_start < now() - p_window THEN 1
        ELSE arl.request_count + 1
      END,
      window_start = CASE
        WHEN arl.window_start < now() - p_window THEN now()
        ELSE arl.window_start
      END
  RETURNING arl.request_count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

COMMENT ON FUNCTION public.check_auth_rate_limit(text, text, integer, interval) IS
  'Atomic per-(ip,endpoint) fixed-window rate limit. Increments and returns '
  'TRUE while within p_max in p_window, FALSE once exceeded. NULL/empty ip is '
  'coalesced to a shared "unknown" bucket (never fails open).';

-- ============================================================================
-- 4. claim_password_reset_token — atomic single-use consume
-- ============================================================================
-- Single conditional UPDATE guarantees use-once under concurrency: the WHERE
-- clause matches only an unused, unexpired token; the row lock serializes
-- concurrent claims, so the second claimant re-evaluates WHERE with used_at
-- already set and matches nothing. Returns the user_id on success, NULL when
-- the token is invalid / expired / already used.
CREATE OR REPLACE FUNCTION public.claim_password_reset_token(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  UPDATE public.password_reset_tokens
  SET used_at = now()
  WHERE token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING user_id INTO v_user_id;

  RETURN v_user_id; -- NULL when no row matched (invalid/expired/used)
END;
$$;

COMMENT ON FUNCTION public.claim_password_reset_token(text) IS
  'Atomically consumes a password reset token (single UPDATE, row-locked). '
  'Returns user_id on success; NULL if invalid/expired/already-used.';

-- ============================================================================
-- 5. Grants — pre-auth edge functions call these via the service_role client.
--    Keep OFF PUBLIC (deny anon/authenticated); allow only service_role.
-- ============================================================================
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(text, text, integer, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_password_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit(text, text, integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_password_reset_token(text) TO service_role;

-- ============================================================================
-- Blast Plans — auto-batched Mass Send over consecutive days (ADR-0003, #707)
-- ============================================================================
-- A Mass Send whose audience exceeds one day's remaining Daily Blast Budget
-- (#706) is sliced into DAILY LOTS over consecutive days. Membership is FROZEN
-- at creation (a snapshot — Leads entering the source Stage afterward are NOT
-- added). Each lot is released by a daily cron job that RE-APPLIES the audience
-- refinements (reply status, contact recency) at send time and consumes at most
-- the day's remaining Daily Blast Budget; the Plan is finite and self-terminating.
--
-- Frozen-not-requery is deliberate (ADR-0003 §4): it keeps a Blast Plan a
-- finite, self-terminating broadcast rather than a standing Stage rule — a
-- standing rule belongs to the Workflow engine, which this feature stays out of.
--
-- A Plan lot consumes the SAME shared blast_daily_usage ledger as a manual Quick
-- Blast (one budget for the day), and the releaser re-runs the same #704
-- refinements over the frozen membership. Both halves live in
-- supabase/functions/_shared/quick-blast/ (plan-slicing.ts, blast-plan.ts).
--
-- Day boundary: America/Sao_Paulo (consistent with #706 — next_release_date is a
-- BRT calendar date; the edge function computes "today" in BRT and passes it in).
--
-- RLS NOTE: org scope via public.get_my_organization_ids() (SECURITY DEFINER
-- helper) — auth.org_id() does NOT exist on this project. This is also the
-- CLAUDE.md-mandated helper that avoids the inline team_members RLS-recursion
-- hazard under Realtime.
-- ============================================================================

-- ── 1. blast_plans — one row per auto-batched Mass Send ──────────────────────
CREATE TABLE IF NOT EXISTS public.blast_plans (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id       uuid        NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- active | paused | completed | cancelled
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','paused','completed','cancelled')),
  -- Descriptor of HOW the audience was resolved (pipe/stage/filter/manual), for
  -- the record only — the releaser never re-queries it (membership is frozen).
  source            jsonb,
  -- Frozen message template (variables resolved per-recipient from the snapshot).
  message           text        NOT NULL,
  -- Frozen Blast Audience refinements (#704) — re-applied at each lot release.
  refinements       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Optional single image (Supabase Storage URL); resolved text becomes caption.
  image_url         text,
  delay_min_ms      integer,
  delay_max_ms      integer,
  total_recipients  integer     NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
  lots_total        integer     NOT NULL DEFAULT 0 CHECK (lots_total >= 0),
  lots_released     integer     NOT NULL DEFAULT 0 CHECK (lots_released >= 0),
  -- Time-of-day the daily releaser fires (BRT). Default 09:00.
  release_time      time        NOT NULL DEFAULT '09:00',
  -- Next BRT calendar date a lot is due. NULL when completed/cancelled.
  next_release_date date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.blast_plans IS
  'Auto-batched Mass Send (ADR-0003 / #707): a frozen audience drained over '
  'consecutive days, each lot bounded by the shared blast_daily_usage budget '
  '(#706) and re-refined (#704) at release. Membership frozen at creation — the '
  'releaser never re-queries the source Stage.';

-- The cron releaser pulls active plans due today: WHERE status='active' AND
-- next_release_date <= today. Partial index keeps that scan tight.
CREATE INDEX IF NOT EXISTS idx_blast_plans_due
  ON public.blast_plans (next_release_date)
  WHERE status = 'active';

-- Org-scoped reads (the Disparos panel lists an org's plans).
CREATE INDEX IF NOT EXISTS idx_blast_plans_org
  ON public.blast_plans (organization_id, status);

ALTER TABLE public.blast_plans ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: a member READS their org's plans (Disparos panel). All
-- writes (create/release/pause/cancel) go through the edge functions via
-- service_role — clients have no insert/update/delete grant, so a plan cannot be
-- created or mutated to widen a blast outside the server-enforced budget.
CREATE POLICY "tenant_isolation_select" ON public.blast_plans
  FOR SELECT USING (organization_id IN (SELECT public.get_my_organization_ids()));

GRANT SELECT ON public.blast_plans TO authenticated;
GRANT ALL    ON public.blast_plans TO service_role;
-- Never expose to anon (cross-tenant leak hardening — 2026-06-01 anon-leak incident).
REVOKE ALL ON public.blast_plans FROM anon;

-- ── 2. blast_plan_recipients — the frozen membership ─────────────────────────
CREATE TABLE IF NOT EXISTS public.blast_plan_recipients (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid        NOT NULL REFERENCES public.blast_plans(id) ON DELETE CASCADE,
  lead_id           uuid        REFERENCES public.leads(id) ON DELETE SET NULL,
  phone             text,
  -- Frozen per-lead template variables captured at creation, so the releaser
  -- renders exactly what the wizard previewed (never a fresh lead read).
  variable_snapshot jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Which day's lot this recipient belongs to (0-based; 0 = creation day).
  -- Deferred recipients are bumped to a later index by the releaser.
  lot_index         integer     NOT NULL DEFAULT 0 CHECK (lot_index >= 0),
  -- pending | sent | skipped
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','sent','skipped')),
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.blast_plan_recipients IS
  'Frozen membership of a Blast Plan (ADR-0003 / #707). One row per Lead captured '
  'at creation; lot_index assigns the day. The releaser reads pending rows for the '
  'current lot, re-applies #704 refinements, marks sent/skipped, and defers the '
  'budget-pressured remainder forward. Never repopulated — membership is frozen.';

-- The releaser fetches a plan's pending recipients for the current lot:
-- WHERE plan_id = ? AND lot_index = ? AND status = 'pending'.
CREATE INDEX IF NOT EXISTS idx_blast_plan_recipients_lot
  ON public.blast_plan_recipients (plan_id, lot_index, status);

ALTER TABLE public.blast_plan_recipients ENABLE ROW LEVEL SECURITY;

-- Tenant isolation via the parent plan's org (recipients have no organization_id
-- column — they belong to exactly one plan). A member reads recipients only for
-- plans in their org. Writes are service_role-only (the releaser).
CREATE POLICY "tenant_isolation_select" ON public.blast_plan_recipients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.blast_plans p
      WHERE p.id = blast_plan_recipients.plan_id
        AND p.organization_id IN (SELECT public.get_my_organization_ids())
    )
  );

GRANT SELECT ON public.blast_plan_recipients TO authenticated;
GRANT ALL    ON public.blast_plan_recipients TO service_role;
REVOKE ALL ON public.blast_plan_recipients FROM anon;

-- ── 3. updated_at trigger on blast_plans ─────────────────────────────────────
-- Reuse the repo's shared trigger fn if present; otherwise define a local one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_blast_plans_updated_at ON public.blast_plans;
CREATE TRIGGER trg_blast_plans_updated_at
  BEFORE UPDATE ON public.blast_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Daily releaser cron (pg_cron → pg_net → blast-plan-release) ───────────
-- Once per day at 09:05 BRT (12:05 UTC; Brazil has no DST since 2019). The edge
-- function pulls every active plan whose next_release_date <= today (BRT) at/after
-- its release_time and releases the next lot. Auth via x-cron-secret. URL + secret
-- read from public.cron_config (no hardcode); see 20260211000002_webhooks_cron.sql.
--
-- Seed (dev — substitute PROJECT_REF):
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('blast_plan_release_url', 'https://PROJECT_REF.supabase.co/functions/v1/blast-plan-release'),
--     ('cron_secret', '<segredo>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- NÃO aplicar em prod nesta slice — aplicação coordenada após smoke em dev.
CREATE TABLE IF NOT EXISTS public.cron_config (key text PRIMARY KEY, value text);

CREATE OR REPLACE FUNCTION public.invoke_blast_plan_release()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'blast_plan_release_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';

  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN
    -- pg_net not installed (local dev) — silence.
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$$;

COMMENT ON FUNCTION public.invoke_blast_plan_release IS
  'ADR-0003 / #707. Calls the blast-plan-release edge function once per day to '
  'release the next lot of every due active Blast Plan. Configure '
  'blast_plan_release_url + cron_secret in cron_config.';

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('blast-plan-release');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    -- 12:05 UTC = 09:05 BRT, just after the 09:00 default release_time.
    PERFORM cron.schedule(
      'blast-plan-release',
      '5 12 * * *',
      'SELECT public.invoke_blast_plan_release()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$outer$;

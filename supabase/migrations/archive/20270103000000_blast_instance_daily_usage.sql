-- ============================================================================
-- Per-number Blast ceiling + multi-number distribution (ADR-0015, #901)
-- ============================================================================
-- ADDITIVE, non-destructive. Closes the ADR-0015 integration on the dispatch
-- backend: the blast guardrail gains a SECOND, finer dimension on top of the
-- existing org-wide Daily Blast Budget (ADR-0003 / #706) — a per-WhatsApp-number
-- daily ceiling (the "Number Daily Cap"), plus the schema a Blast Plan needs to
-- distribute one audience across several numbers and respect a per-leva send
-- window.
--
-- Coexistence with ADR-0003:
--   * blast_daily_usage (org-wide ledger) is NOT touched — it keeps working for
--     single-number Quick Blasts and as a defense-in-depth cross-blast tally.
--   * This migration only ADDS: a per-number ledger, a per-number cap column, a
--     per-recipient sending-number stamp, and the plan's send-window columns.
--   Nothing here drops or rewrites an existing object, so a prod apply cannot
--   regress the single-number path already live.
--
-- Day boundary: America/Sao_Paulo calendar date, identical to #706 — the edge
-- function computes the BRT date and passes it in (usage_date partition key).
--
-- RLS NOTE: org scope via public.get_my_organization_ids() (SECURITY DEFINER
-- helper) — auth.org_id() does NOT exist on this project, and this is the
-- CLAUDE.md-mandated helper that avoids the inline team_members RLS-recursion
-- hazard under Realtime. blast_instance_daily_usage has no organization_id of its
-- own (a number belongs to exactly one org via whatsapp_instances), so the policy
-- joins through the parent instance.
--
-- APLICAR dev → prod com aval explícito do CTO (regra do projeto). Não aplicado
-- automaticamente por esta slice.
-- ============================================================================

-- ── 1. Per-number Daily Cap on whatsapp_instances ───────────────────────────
-- Default 80 = the Torque-recommended safe value (CAP_RECOMMENDED, speed-safety
-- slider). A freshly connected number is clamped lower in the wizard; the column
-- is the per-number ceiling the server enforces. Additive: existing rows inherit
-- the default, so live single-number blasts keep dispatching unchanged.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS daily_blast_cap INTEGER NOT NULL DEFAULT 80;

COMMENT ON COLUMN public.whatsapp_instances.daily_blast_cap IS
  'Per-number daily ceiling (Number Daily Cap, ADR-0015): max Leads this number '
  'may be used to blast per calendar day (America/Sao_Paulo). Server-enforced via '
  'blast_instance_daily_usage. Default 80 (CAP_RECOMMENDED). Distinct from the '
  'org-wide organizations.daily_blast_budget (#706), which still applies.';

-- ── 2. Per-number-per-day usage ledger ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blast_instance_daily_usage (
  instance_id uuid    NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  usage_date  date    NOT NULL,
  leads_sent  integer NOT NULL DEFAULT 0 CHECK (leads_sent >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, usage_date)
);

COMMENT ON TABLE public.blast_instance_daily_usage IS
  'Per-number-per-day ledger of Leads blasted FROM each WhatsApp number (ADR-0015 '
  '/ #901). usage_date is the America/Sao_Paulo calendar date. Incremented '
  'atomically by increment_instance_daily_usage() AFTER a real dispatch (never on '
  'dry-run), read fail-closed by the enforcement core. Mirrors blast_daily_usage '
  'but keyed by number, enabling the per-number cap + multi-number round-robin.';

-- The composite PK (instance_id, usage_date) already indexes the only query shape
-- (point lookup of today's row per number); no extra index needed.

ALTER TABLE public.blast_instance_daily_usage ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: a member may READ the ledger for numbers in their org (UI
-- headroom). Writes go exclusively through the SECURITY DEFINER RPC (service_role
-- from the edge function) — clients have NO insert/update grant, so the ledger
-- cannot be tampered with to widen a blast. Org scope joins through the parent
-- whatsapp_instances row via get_my_organization_ids().
CREATE POLICY "tenant_isolation_select" ON public.blast_instance_daily_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_instances wi
      WHERE wi.id = blast_instance_daily_usage.instance_id
        AND wi.organization_id IN (SELECT public.get_my_organization_ids())
    )
  );

GRANT SELECT ON public.blast_instance_daily_usage TO authenticated;
GRANT ALL    ON public.blast_instance_daily_usage TO service_role;
-- Never expose to anon (cross-tenant leak hardening — 2026-06-01 anon-leak incident).
REVOKE ALL ON public.blast_instance_daily_usage FROM anon;

-- ── 3. Atomic UPSERT-increment RPC (per-number) ─────────────────────────────
-- Mirrors increment_blast_daily_usage exactly: SECURITY DEFINER so the single
-- server caller (service_role, after a successful dispatch) atomically
-- inserts-or-increments the day's row regardless of RLS. search_path = '' with
-- fully-qualified names (proven sibling pattern — this RPC needs no extension
-- functions, so the empty search_path is both safe and the strictest choice;
-- pgcrypto/gen_random_* are NOT used here). EXECUTE granted ONLY to service_role.
CREATE OR REPLACE FUNCTION public.increment_instance_daily_usage(
  p_instance_id uuid,
  p_usage_date  date,
  p_count       integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total integer;
BEGIN
  -- Non-positive increments are a no-op; return the current value (or 0).
  IF p_count IS NULL OR p_count <= 0 THEN
    SELECT COALESCE(leads_sent, 0) INTO v_total
    FROM public.blast_instance_daily_usage
    WHERE instance_id = p_instance_id AND usage_date = p_usage_date;
    RETURN COALESCE(v_total, 0);
  END IF;

  INSERT INTO public.blast_instance_daily_usage (instance_id, usage_date, leads_sent)
  VALUES (p_instance_id, p_usage_date, p_count)
  ON CONFLICT (instance_id, usage_date)
  DO UPDATE SET
    leads_sent = public.blast_instance_daily_usage.leads_sent + EXCLUDED.leads_sent,
    updated_at = now()
  RETURNING leads_sent INTO v_total;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_instance_daily_usage(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_instance_daily_usage(uuid, date, integer) TO service_role;

COMMENT ON FUNCTION public.increment_instance_daily_usage(uuid, date, integer) IS
  'Atomically add p_count to a number''s blast_instance_daily_usage row for '
  'p_usage_date (INSERT ... ON CONFLICT DO UPDATE leads_sent += excluded). Called '
  'by the edge function via service_role AFTER a real dispatch — never on dry-run. '
  'Returns the post-increment day total. ADR-0015 / #901.';

-- ── 4. Per-recipient sending-number stamp on blast_plan_recipients ───────────
-- Which number will send each frozen recipient (the multi-number distribution
-- decided by planBlast at creation). Nullable + ON DELETE SET NULL: legacy plans
-- created before ADR-0015 leave it NULL and fall back to the plan's single
-- instance_id at release time, so in-flight plans never break.
ALTER TABLE public.blast_plan_recipients
  ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.blast_plan_recipients.instance_id IS
  'The WhatsApp number assigned to send this frozen recipient (ADR-0015 '
  'multi-number round-robin). NULL for legacy single-number plans — the releaser '
  'then falls back to blast_plans.instance_id.';

-- The releaser groups a lot''s pending recipients by number; index the access path.
CREATE INDEX IF NOT EXISTS idx_blast_plan_recipients_instance
  ON public.blast_plan_recipients (plan_id, lot_index, instance_id)
  WHERE status = 'pending';

-- ── 5. Per-leva send window on blast_plans ──────────────────────────────────
-- The allowed window the daily releaser honours (ADR-0015 / #909). NULL columns
-- mean "no window" (legacy plans) — the releaser only defers a lot out of the
-- window when window_days is populated. Defaults applied at the edge/app layer
-- (08:00–20:00, Mon–Sat) when the wizard omits them.
ALTER TABLE public.blast_plans
  ADD COLUMN IF NOT EXISTS window_days         integer[],
  ADD COLUMN IF NOT EXISTS window_from_minutes integer,
  ADD COLUMN IF NOT EXISTS window_to_minutes   integer;

COMMENT ON COLUMN public.blast_plans.window_days IS
  'Allowed weekdays for lot release (0=Sun..6=Sat), ADR-0015/#909. NULL = no '
  'window (legacy). Default applied app-side: Mon–Sat.';
COMMENT ON COLUMN public.blast_plans.window_from_minutes IS
  'Window open, minutes from local midnight (e.g. 480 = 08:00). NULL = unbounded.';
COMMENT ON COLUMN public.blast_plans.window_to_minutes IS
  'Window close (exclusive), minutes from local midnight (e.g. 1200 = 20:00). '
  'NULL = unbounded.';

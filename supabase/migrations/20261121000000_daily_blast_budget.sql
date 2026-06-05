-- ============================================================================
-- Daily Blast Budget — Org-wide daily ceiling on Mass Send volume (ADR-0003, #706)
-- ============================================================================
-- Supersedes the per-blast cap *framing* of ADR-0002. The security-critical
-- guardrail is now an Organization-wide ceiling on how many Leads may be
-- messaged via Mass Send per CALENDAR DAY, summed across every blast — manual
-- Quick Blasts today, Blast Plan lots in #707. Server-enforced, fail-closed:
-- a missing/invalid budget resolves to the default ceiling (never unlimited),
-- and a ledger read error blocks the day rather than flinging it open
-- (enforcement in supabase/functions/_shared/quick-blast/daily-budget.ts).
--
-- Two schema parts:
--   1. organizations.daily_blast_budget — the per-day ceiling (default 200).
--      organizations.quick_blast_max_leads (ADR-0002) STAYS as the optional
--      per-blast clamp that operates WITHIN this daily budget.
--   2. blast_daily_usage — a per-org-per-day ledger of leads already sent, plus
--      an atomic UPSERT-increment RPC so concurrent same-day blasts never lose a
--      count.
--
-- Day boundary: the ledger partition (usage_date) is the America/Sao_Paulo
-- calendar date — the business timezone used across the product
-- (getTimeBasedVariables, followupSchedule, workflow windows). The edge function
-- computes the BRT date and passes it in; the budget resets at BRT midnight, so
-- a blast at 23:00 BRT and one at 01:00 BRT count against different days.
-- ============================================================================

-- ── 1. Per-day ceiling on organizations ─────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS daily_blast_budget INTEGER NOT NULL DEFAULT 200;

COMMENT ON COLUMN public.organizations.daily_blast_budget IS
  'Org-wide Mass Send daily ceiling: max Leads messaged via blast per calendar '
  'day (America/Sao_Paulo), summed across every blast. Server-enforced, '
  'fail-closed — ADR-0003. Default 200. quick_blast_max_leads is the optional '
  'per-blast clamp WITHIN this budget.';

-- ── 2. Per-org-per-day usage ledger ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blast_daily_usage (
  organization_id uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  usage_date      date    NOT NULL,
  leads_sent      integer NOT NULL DEFAULT 0 CHECK (leads_sent >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, usage_date)
);

COMMENT ON TABLE public.blast_daily_usage IS
  'Per-org-per-day ledger of Leads messaged via Mass Send (Quick Blasts + Blast '
  'Plan lots). usage_date is the America/Sao_Paulo calendar date. Incremented '
  'atomically by increment_blast_daily_usage() AFTER a real dispatch (never on '
  'dry-run). Read fail-closed by the enforcement core — ADR-0003 / #706.';

-- The composite PK (organization_id, usage_date) already indexes the only query
-- shape (point lookup of today's row per org); no extra index needed.

ALTER TABLE public.blast_daily_usage ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: a member may READ their org's ledger (so the UI could show
-- remaining headroom). Writes go exclusively through the SECURITY DEFINER RPC
-- (service_role from the edge function) — clients have NO insert/update grant,
-- so the ledger cannot be tampered with to widen a blast.
-- Org scope via get_my_organization_ids() (SECURITY DEFINER helper) — auth.org_id()
-- is not present in this project; this is also the CLAUDE.md-mandated helper that
-- avoids the inline team_members RLS-recursion hazard.
CREATE POLICY "tenant_isolation_select" ON public.blast_daily_usage
  FOR SELECT USING (organization_id IN (SELECT public.get_my_organization_ids()));

GRANT SELECT ON public.blast_daily_usage TO authenticated;
GRANT ALL    ON public.blast_daily_usage TO service_role;
-- Never expose the ledger to the anon role (cross-tenant leak hardening — see
-- the 2026-06-01 anon-leak incident).
REVOKE ALL ON public.blast_daily_usage FROM anon;

-- ── 3. Atomic UPSERT-increment RPC ──────────────────────────────────────────
-- SECURITY DEFINER so the single server caller (service_role, from the edge
-- function after a successful dispatch) atomically inserts-or-increments the
-- day's row regardless of RLS. search_path = '' per repo rules. EXECUTE is
-- granted ONLY to service_role and revoked from PUBLIC/anon/authenticated — the
-- increment path is server-only and must not be widenable by any client.
CREATE OR REPLACE FUNCTION public.increment_blast_daily_usage(
  p_org_id     uuid,
  p_usage_date date,
  p_count      integer
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
    FROM public.blast_daily_usage
    WHERE organization_id = p_org_id AND usage_date = p_usage_date;
    RETURN COALESCE(v_total, 0);
  END IF;

  INSERT INTO public.blast_daily_usage (organization_id, usage_date, leads_sent)
  VALUES (p_org_id, p_usage_date, p_count)
  ON CONFLICT (organization_id, usage_date)
  DO UPDATE SET
    leads_sent = public.blast_daily_usage.leads_sent + EXCLUDED.leads_sent,
    updated_at = now()
  RETURNING leads_sent INTO v_total;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_blast_daily_usage(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_blast_daily_usage(uuid, date, integer) TO service_role;

COMMENT ON FUNCTION public.increment_blast_daily_usage(uuid, date, integer) IS
  'Atomically add p_count to an org''s blast_daily_usage row for p_usage_date '
  '(INSERT ... ON CONFLICT DO UPDATE leads_sent += excluded). Called by the edge '
  'function via service_role AFTER a real dispatch — never on dry-run. Returns '
  'the post-increment day total. ADR-0003 / #706.';

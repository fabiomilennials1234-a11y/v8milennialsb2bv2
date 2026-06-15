-- 20261128000003_meta_asset_bindings.sql
-- Meta agency integration (ADR-0009) — Slice 2 (#808).
-- Master-managed binding of Meta assets (Pages + Ad Accounts) to Orgs, the
-- meta_lead_id join key on leads, and the idempotency ledger for Lead
-- Conversion Signals. Writes happen server-side (master edge fn + cron) as
-- service_role; authenticated gets read-only / no access, fail-closed.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. meta_asset_bindings — org → { page | ad_account }, the source of truth
--    for leadgen routing and conversion targeting. One asset → one org.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.meta_asset_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('page', 'ad_account')),
  asset_id text NOT NULL,            -- page id (e.g. 786842534493813) or ad account id (act_…)
  asset_name text,                   -- human label, cached at bind time
  dataset_id text,                   -- ad_account only: Conversions API target (#5)
  status text NOT NULL DEFAULT 'active',
  last_polled_at timestamptz,        -- page only: last successful leadgen poll
  last_error text,                   -- last enumeration/poll/subscribe error
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- One asset belongs to exactly one org (enforces "a Page maps to one Org").
CREATE UNIQUE INDEX uq_meta_asset_bindings_asset
  ON public.meta_asset_bindings(asset_type, asset_id);
CREATE INDEX idx_meta_asset_bindings_organization_id
  ON public.meta_asset_bindings(organization_id);

ALTER TABLE public.meta_asset_bindings ENABLE ROW LEVEL SECURITY;

-- Org members may READ their own bindings (status surfacing). No authenticated
-- writes — binding is master-only via service_role edge function.
CREATE POLICY "tenant_isolation_select" ON public.meta_asset_bindings
  FOR SELECT USING (organization_id = auth.org_id());

GRANT SELECT ON public.meta_asset_bindings TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. leads.meta_lead_id — promote metadata->>'leadgen_id' to an indexed column.
--    Join key for the Lead Conversion Signal (only leads with one can signal).
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meta_lead_id text;

CREATE INDEX IF NOT EXISTS idx_leads_meta_lead_id
  ON public.leads(meta_lead_id) WHERE meta_lead_id IS NOT NULL;

-- Backfill from existing leadgen captures.
UPDATE public.leads
  SET meta_lead_id = metadata->>'leadgen_id'
  WHERE meta_lead_id IS NULL
    AND metadata ? 'leadgen_id'
    AND coalesce(metadata->>'leadgen_id', '') <> '';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. meta_signals_sent — idempotency ledger: each event_name at most once/lead.
--    Service-role only (written by the signal dispatcher).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.meta_signals_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN ('qualified', 'meeting', 'sold')),
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_meta_signals_sent_lead_event
  ON public.meta_signals_sent(lead_id, event_name);
CREATE INDEX idx_meta_signals_sent_organization_id
  ON public.meta_signals_sent(organization_id);

ALTER TABLE public.meta_signals_sent ENABLE ROW LEVEL SECURITY;
-- No policies, no grants to authenticated → service_role only (fail-closed).

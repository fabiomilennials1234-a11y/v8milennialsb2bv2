-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708133105  name: metrics_commission_columns_projection_deferred
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000040 (#994, ADR-0017 §6) — SCHEMA ONLY; projeção DEFERIDA (CTO 2026-07-08)
-- Aplica só as colunas/constraints que get_commission_ledger (#997) lê.
-- fn_project_commission + trg_sale_events_project_commission + protect trigger +
-- column-grants ficam PRA DEPLOY DO FRONTEND SP-3 (senão projeção vazaria na
-- lista Comissoes do frontend deployado, que não filtra source).

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS sale_event_id uuid REFERENCES public.sale_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CONSTRAINT commissions_source_check CHECK (source IN ('manual','sale_event_projection')),
  ADD COLUMN IF NOT EXISTS rate_percent numeric
    CONSTRAINT commissions_rate_percent_non_negative CHECK (rate_percent IS NULL OR rate_percent >= 0);

ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_sale_event_id_key UNIQUE (sale_event_id);

ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_projection_coherence
  CHECK ((source = 'sale_event_projection') = (sale_event_id IS NOT NULL));

COMMENT ON COLUMN public.commissions.source IS '#994 — manual (fluxo vigente) | sale_event_projection (projetada do caderno). Projeção DEFERIDA em prod até deploy do frontend SP-3.';

CREATE INDEX idx_commissions_projection_org_period
  ON public.commissions (organization_id, year, month)
  WHERE source = 'sale_event_projection';

-- =============================================================================
-- Migration: lead_history — metadata DEFAULT '{}'::jsonb + indexes timeline
-- Issue: #288 (PRD #284 — Modal Lead v2, Fase 5 audit trail)
-- Date: 2026-10-30 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Pre-condições do audit:
--   - `action` JÁ É text NOT NULL (migration original 20260106163757). ✓
--   - `metadata jsonb` JÁ EXISTE (migration 20260731100000), porém nullable
--     sem DEFAULT — INSERTs sem metadata gravam NULL e quebram queries
--     `metadata->>'foo' IS NOT NULL`. Esta migration normaliza para '{}'.
--   - RLS JÁ ESTÁ habilitada com policies tenant_isolation + service_role
--     insert + master cross-org. ✓
--
-- Mudanças desta migration:
--   1. Backfill metadata NULL → '{}'::jsonb (rows existentes).
--   2. ALTER COLUMN metadata SET DEFAULT '{}'::jsonb.
--   3. ALTER COLUMN metadata SET NOT NULL (post-backfill).
--   4. Index composto (lead_id, created_at DESC) — timeline do modal.
--   5. Index composto (organization_id, created_at DESC) — analytics + audit
--      cross-lead por org.
--
-- Não toca:
--   - action (já text)
--   - RLS (já configurada)
--   - source, entity_type, entity_id (fora do escopo do PRD)

-- 1. Backfill — rows com metadata NULL viram '{}'
UPDATE public.lead_history
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

-- 2. Default '{}' pra INSERTs futuros
ALTER TABLE public.lead_history
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- 3. NOT NULL agora que tudo está backfilado
ALTER TABLE public.lead_history
  ALTER COLUMN metadata SET NOT NULL;

-- 4. Index timeline por lead (modal LeadActivityColumn)
CREATE INDEX IF NOT EXISTS idx_lead_history_lead_created
  ON public.lead_history (lead_id, created_at DESC);

-- 5. Index timeline por org (audit cross-lead, analytics)
CREATE INDEX IF NOT EXISTS idx_lead_history_org_created
  ON public.lead_history (organization_id, created_at DESC);

-- Comments
COMMENT ON COLUMN public.lead_history.metadata IS
  'Payload jsonb arbitrário por entry. Default ''{}''::jsonb. Usado pra trace de actor (master_user_id, sender_id), before/after de field_updated, channel/direction de message logs (F5.2).';
COMMENT ON INDEX public.idx_lead_history_lead_created IS
  'Timeline do modal de lead — ordenação descendente por data.';
COMMENT ON INDEX public.idx_lead_history_org_created IS
  'Audit cross-lead por org. Suporta compliance/LGPD queries por data.';

-- =============================================================================
-- NUCLEAR FIX: Closer visibility on leads table
-- =============================================================================
-- ROOT CAUSE: leads.closer_id is NULL for leads where the closer was assigned
-- at the pipe level (pipe_confirmacao, pipe_propostas) but never synced back
-- to the leads table.
--
-- When pipe_confirmacao.closer_id = Weder but leads.closer_id = NULL:
--   is_user_responsible(sdr_id=Fustenberg, closer_id=NULL) → FALSE
--   → leads RLS blocks the row
--   → PostgREST LEFT JOIN returns null for lead
--   → Frontend hides the card (if (!lead) return false)
--
-- FIX:
-- 1) Re-create is_user_responsible (force correct DB version)
-- 2) Drop old redundant leads SELECT policy
-- 3) Backfill leads.closer_id FROM pipe_propostas and pipe_confirmacao
-- 4) Trigger: sync closer_id from pipes back to leads on INSERT/UPDATE
-- 5) Backfill leads.sdr_id from pipe_confirmacao (same pattern)
-- =============================================================================

-- ============================================================
-- 1) FORCE CORRECT is_user_responsible
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_user_responsible(
  p_sdr_id UUID,
  p_closer_id UUID,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
    AND (
      (p_sdr_id IS NOT NULL AND id = p_sdr_id)
      OR
      (p_closer_id IS NOT NULL AND id = p_closer_id)
    )
  )
  OR
  (p_assigned_to IS NOT NULL AND p_assigned_to = auth.uid())
$$;

-- ============================================================
-- 2) DROP OLD REDUNDANT leads SELECT POLICY
--    "leads_select_by_responsibility" was never dropped and coexists
--    with "leads_select_by_responsibility_and_permissions".
--    Remove it to reduce confusion and ensure single clean policy.
-- ============================================================
DROP POLICY IF EXISTS "leads_select_by_responsibility" ON public.leads;

-- ============================================================
-- 3) BACKFILL leads.closer_id FROM pipe_propostas
--    pipe_propostas is the primary source of closer assignment.
--    Use the MOST RECENT pipe_propostas record per lead.
-- ============================================================
UPDATE public.leads l
SET closer_id = sub.closer_id,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, closer_id
  FROM public.pipe_propostas
  WHERE closer_id IS NOT NULL
  ORDER BY lead_id, updated_at DESC
) sub
WHERE sub.lead_id = l.id
  AND l.closer_id IS NULL;

-- ============================================================
-- 4) BACKFILL leads.closer_id FROM pipe_confirmacao
--    For any leads still without closer_id, try pipe_confirmacao.
-- ============================================================
UPDATE public.leads l
SET closer_id = sub.closer_id,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, closer_id
  FROM public.pipe_confirmacao
  WHERE closer_id IS NOT NULL
  ORDER BY lead_id, updated_at DESC
) sub
WHERE sub.lead_id = l.id
  AND l.closer_id IS NULL;

-- ============================================================
-- 5) BACKFILL leads.sdr_id FROM pipe_confirmacao (same pattern)
-- ============================================================
UPDATE public.leads l
SET sdr_id = sub.sdr_id,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, sdr_id
  FROM public.pipe_confirmacao
  WHERE sdr_id IS NOT NULL
  ORDER BY lead_id, updated_at DESC
) sub
WHERE sub.lead_id = l.id
  AND l.sdr_id IS NULL;

-- ============================================================
-- 6) TRIGGER: sync closer_id from pipe_propostas → leads
--    Fires on INSERT or UPDATE of closer_id.
--    SECURITY DEFINER so it bypasses leads RLS for the UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_closer_to_lead_from_pipe()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync if the pipe record has a closer_id
  IF NEW.closer_id IS NOT NULL THEN
    UPDATE public.leads
    SET closer_id = NEW.closer_id,
        updated_at = NOW()
    WHERE id = NEW.lead_id
      AND (closer_id IS NULL OR closer_id <> NEW.closer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger on pipe_propostas
DROP TRIGGER IF EXISTS trg_sync_closer_to_lead_from_pipe_propostas ON public.pipe_propostas;
CREATE TRIGGER trg_sync_closer_to_lead_from_pipe_propostas
  AFTER INSERT OR UPDATE OF closer_id ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_closer_to_lead_from_pipe();

-- Trigger on pipe_confirmacao
DROP TRIGGER IF EXISTS trg_sync_closer_to_lead_from_pipe_confirmacao ON public.pipe_confirmacao;
CREATE TRIGGER trg_sync_closer_to_lead_from_pipe_confirmacao
  AFTER INSERT OR UPDATE OF closer_id ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_closer_to_lead_from_pipe();

-- ============================================================
-- 7) TRIGGER: sync sdr_id from pipe_confirmacao → leads
--    (pipe_confirmacao may have sdr_id that leads doesn't)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_sdr_to_lead_from_pipe()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sdr_id IS NOT NULL THEN
    UPDATE public.leads
    SET sdr_id = NEW.sdr_id,
        updated_at = NOW()
    WHERE id = NEW.lead_id
      AND sdr_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_sdr_to_lead_from_pipe_confirmacao ON public.pipe_confirmacao;
CREATE TRIGGER trg_sync_sdr_to_lead_from_pipe_confirmacao
  AFTER INSERT OR UPDATE OF sdr_id ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_sdr_to_lead_from_pipe();

-- ============================================================
-- 8) VERIFY: Log counts for audit (these are just SELECT, no side effects)
-- ============================================================
DO $$
DECLARE
  v_leads_null_closer INT;
  v_leads_null_sdr INT;
BEGIN
  SELECT count(*) INTO v_leads_null_closer
  FROM public.leads l
  WHERE l.closer_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.pipe_propostas pp WHERE pp.lead_id = l.id AND pp.closer_id IS NOT NULL
      UNION ALL
      SELECT 1 FROM public.pipe_confirmacao pc WHERE pc.lead_id = l.id AND pc.closer_id IS NOT NULL
    );

  SELECT count(*) INTO v_leads_null_sdr
  FROM public.leads l
  WHERE l.sdr_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.pipe_confirmacao pc WHERE pc.lead_id = l.id AND pc.sdr_id IS NOT NULL
    );

  RAISE NOTICE 'Post-backfill: % leads still with NULL closer_id (should be 0)', v_leads_null_closer;
  RAISE NOTICE 'Post-backfill: % leads still with NULL sdr_id (should be 0)', v_leads_null_sdr;
END $$;

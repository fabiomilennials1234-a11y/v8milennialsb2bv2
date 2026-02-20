-- Fix: Closer visibility in pipe_confirmacao using COALESCE + subquery pattern
-- Follows the same proven approach used by pipe_propostas.
--
-- Instead of relying on pipe_confirmacao.closer_id (which may be NULL),
-- uses COALESCE to fall back to leads.closer_id/sdr_id via subquery.
-- This guarantees the closer sees records even when pipe_confirmacao.closer_id is NULL.

-- ============================================================
-- 1) SELECT POLICY: COALESCE with leads fallback
-- ============================================================
DROP POLICY IF EXISTS "pipe_confirmacao_select_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_select_by_permissions"
  ON public.pipe_confirmacao FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(
        COALESCE(sdr_id, (SELECT l.sdr_id FROM public.leads l WHERE l.id = lead_id LIMIT 1)),
        COALESCE(closer_id, (SELECT l.closer_id FROM public.leads l WHERE l.id = lead_id LIMIT 1))
      )
      OR public.can_see_lead_by_team_member_permissions(
        organization_id,
        'pipe_confirmacao',
        COALESCE(sdr_id, (SELECT l.sdr_id FROM public.leads l WHERE l.id = lead_id LIMIT 1)),
        COALESCE(closer_id, (SELECT l.closer_id FROM public.leads l WHERE l.id = lead_id LIMIT 1))
      )
    )
  );

-- ============================================================
-- 2) UPDATE POLICY: same COALESCE pattern
-- ============================================================
DROP POLICY IF EXISTS "pipe_confirmacao_update_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_update_by_permissions"
  ON public.pipe_confirmacao FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(
        COALESCE(sdr_id, (SELECT l.sdr_id FROM public.leads l WHERE l.id = lead_id LIMIT 1)),
        COALESCE(closer_id, (SELECT l.closer_id FROM public.leads l WHERE l.id = lead_id LIMIT 1))
      )
      OR public.can_see_lead_by_team_member_permissions(
        organization_id,
        'pipe_confirmacao',
        COALESCE(sdr_id, (SELECT l.sdr_id FROM public.leads l WHERE l.id = lead_id LIMIT 1)),
        COALESCE(closer_id, (SELECT l.closer_id FROM public.leads l WHERE l.id = lead_id LIMIT 1))
      )
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 3) TRIGGER: auto-sync closer_id/sdr_id from leads on INSERT
--    (idempotent - replaces if already exists from previous migration)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_pipe_confirmacao_from_lead()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.closer_id IS NULL OR NEW.sdr_id IS NULL THEN
    SELECT
      COALESCE(NEW.closer_id, l.closer_id),
      COALESCE(NEW.sdr_id, l.sdr_id)
    INTO NEW.closer_id, NEW.sdr_id
    FROM public.leads l
    WHERE l.id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_pipe_confirmacao_from_lead ON public.pipe_confirmacao;
CREATE TRIGGER trg_sync_pipe_confirmacao_from_lead
  BEFORE INSERT ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pipe_confirmacao_from_lead();

-- ============================================================
-- 4) BACKFILL: sync NULL closer_id/sdr_id from leads
-- ============================================================
UPDATE public.pipe_confirmacao pc
SET closer_id = l.closer_id,
    updated_at = NOW()
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.closer_id IS NULL
  AND l.closer_id IS NOT NULL;

UPDATE public.pipe_confirmacao pc
SET sdr_id = l.sdr_id,
    updated_at = NOW()
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.sdr_id IS NULL
  AND l.sdr_id IS NOT NULL;

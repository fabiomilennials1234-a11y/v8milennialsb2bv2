-- Fix: Closer visibility in pipe_confirmacao
-- Problem: Even after backfilling pipe_confirmacao.closer_id, closers can't see records
-- because leads.closer_id may be NULL (never assigned) or the backfill didn't match.
--
-- Solution:
-- 1) Update RLS policies to also check leads.closer_id/sdr_id (fallback via JOIN)
-- 2) Create trigger to auto-sync closer_id/sdr_id from leads on INSERT
-- 3) Re-run backfill for any remaining NULL cases

-- ============================================================
-- 1) UPDATE SELECT POLICY: fallback to leads.closer_id/sdr_id
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
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'pipe_confirmacao', sdr_id, closer_id)
      -- Fallback: if user is responsible for the LEAD itself (handles NULL closer_id on pipe_confirmacao)
      OR EXISTS (
        SELECT 1 FROM public.leads l
        JOIN public.team_members tm
          ON tm.user_id = auth.uid()
          AND tm.organization_id = pipe_confirmacao.organization_id
        WHERE l.id = pipe_confirmacao.lead_id
        AND (
          (l.closer_id IS NOT NULL AND l.closer_id = tm.id)
          OR (l.sdr_id IS NOT NULL AND l.sdr_id = tm.id)
        )
      )
    )
  );

-- ============================================================
-- 2) UPDATE UPDATE POLICY: same fallback
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
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'pipe_confirmacao', sdr_id, closer_id)
      OR EXISTS (
        SELECT 1 FROM public.leads l
        JOIN public.team_members tm
          ON tm.user_id = auth.uid()
          AND tm.organization_id = pipe_confirmacao.organization_id
        WHERE l.id = pipe_confirmacao.lead_id
        AND (
          (l.closer_id IS NOT NULL AND l.closer_id = tm.id)
          OR (l.sdr_id IS NOT NULL AND l.sdr_id = tm.id)
        )
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
-- 4) BACKFILL: re-run for any remaining NULL cases
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

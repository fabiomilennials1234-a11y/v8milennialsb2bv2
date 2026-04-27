-- ============================================================================
-- FIX: Pipe RLS policies must check responsible_id for visibility
--
-- ROOT CAUSE: When responsible_id is changed on a lead, the new responsible
-- user cannot see the card because pipe RLS policies only check sdr_id
-- and closer_id — not responsible_id.
--
-- Also adds reverse sync trigger: leads.responsible_id → pipe tables,
-- so changing the responsible on the lead propagates to all associated pipes.
--
-- Date: 2026-08-26
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PIPE_WHATSAPP: SELECT + UPDATE — add responsible_id check
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pipe_whatsapp_select_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_select_by_permissions"
  ON public.pipe_whatsapp FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  );

DROP POLICY IF EXISTS "pipe_whatsapp_update_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_update_by_permissions"
  ON public.pipe_whatsapp FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 2. PIPE_CONFIRMACAO: SELECT + UPDATE — add responsible_id check
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pipe_confirmacao_select_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_select_by_permissions"
  ON public.pipe_confirmacao FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  );

DROP POLICY IF EXISTS "pipe_confirmacao_update_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_update_by_permissions"
  ON public.pipe_confirmacao FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 3. PIPE_PROPOSTAS: SELECT + UPDATE — add responsible_id check
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pipe_propostas_select_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_select_by_permissions"
  ON public.pipe_propostas FOR SELECT
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  );

DROP POLICY IF EXISTS "pipe_propostas_update_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_update_by_permissions"
  ON public.pipe_propostas FOR UPDATE
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  )
  WITH CHECK (true);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. CAMPANHA_LEADS: SELECT — add responsible_id check
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "campanha_leads_select_by_permissions" ON public.campanha_leads;
CREATE POLICY "campanha_leads_select_by_permissions"
  ON public.campanha_leads FOR SELECT
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 5. REVERSE SYNC: leads.responsible_id → all pipe tables
--    When responsible changes on the lead, propagate to associated pipes.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_responsible_from_lead_to_pipes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when responsible_id actually changes
  IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
    -- Update pipe_whatsapp
    UPDATE public.pipe_whatsapp
    SET responsible_id = NEW.responsible_id
    WHERE lead_id = NEW.id
      AND (responsible_id IS DISTINCT FROM NEW.responsible_id);

    -- Update pipe_confirmacao
    UPDATE public.pipe_confirmacao
    SET responsible_id = NEW.responsible_id
    WHERE lead_id = NEW.id
      AND (responsible_id IS DISTINCT FROM NEW.responsible_id);

    -- Update pipe_propostas
    UPDATE public.pipe_propostas
    SET responsible_id = NEW.responsible_id
    WHERE lead_id = NEW.id
      AND (responsible_id IS DISTINCT FROM NEW.responsible_id);

    -- Update campanha_leads
    UPDATE public.campanha_leads
    SET responsible_id = NEW.responsible_id
    WHERE lead_id = NEW.id
      AND (responsible_id IS DISTINCT FROM NEW.responsible_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_responsible_from_lead_to_pipes ON public.leads;
CREATE TRIGGER trg_sync_responsible_from_lead_to_pipes
  AFTER UPDATE OF responsible_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_responsible_from_lead_to_pipes();

COMMENT ON FUNCTION public.sync_responsible_from_lead_to_pipes() IS
  'Reverse sync: when leads.responsible_id changes, propagate to all associated pipe and campanha_leads records.';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Validation
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Check trigger exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_responsible_from_lead_to_pipes'
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: reverse sync trigger not created';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: pipe RLS policies updated and reverse sync trigger created.';
END;
$$;

-- =============================================================================
-- FIX: Leads RLS - closer reatribuído no pipe mas não no lead
-- =============================================================================
-- CAUSA RAIZ: leads.closer_id = closer_antigo (NÃO NULL, NÃO Weder).
-- O closer foi reatribuído no pipe_confirmacao/pipe_propostas para Weder,
-- mas leads.closer_id nunca foi atualizado. O backfill anterior só
-- atualizava quando leads.closer_id IS NULL.
--
-- SOLUÇÃO:
-- 1) Função SECURITY DEFINER que verifica se o usuário é closer em
--    pipe_confirmacao ou pipe_propostas para aquele lead.
--    SECURITY DEFINER = bypassa RLS nos pipes (sem dependência circular).
-- 2) Adicionar essa verificação nas policies SELECT e UPDATE de leads.
-- 3) Backfill: sincronizar leads.closer_id com o closer mais recente dos pipes.
-- 4) Atualizar trigger para sempre sincronizar (não só quando NULL).
-- =============================================================================

-- ============================================================
-- 1) FUNÇÃO: Verifica se user é closer/sdr em algum pipe do lead
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_user_responsible_in_any_pipe(p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.pipe_confirmacao pc
        WHERE pc.lead_id = p_lead_id
        AND (pc.closer_id = tm.id OR pc.sdr_id = tm.id)
      )
      OR EXISTS (
        SELECT 1 FROM public.pipe_propostas pp
        WHERE pp.lead_id = p_lead_id
        AND pp.closer_id = tm.id
      )
    )
  )
$$;

COMMENT ON FUNCTION public.is_user_responsible_in_any_pipe IS
  'Verifica se o user é closer/sdr em pipe_confirmacao ou pipe_propostas para um lead. SECURITY DEFINER para evitar dependência circular de RLS.';

-- ============================================================
-- 2) ATUALIZAR POLICY SELECT de leads
-- ============================================================
DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      -- NEW: Se o user é closer/sdr em algum pipe desse lead, pode ver
      OR public.is_user_responsible_in_any_pipe(id)
    )
  );

-- ============================================================
-- 3) ATUALIZAR POLICY UPDATE de leads
-- ============================================================
DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 4) BACKFILL: Sincronizar leads.closer_id do pipe mais recente
--    Agora atualiza MESMO quando leads.closer_id já tem valor
-- ============================================================

-- Prioridade 1: pipe_propostas (mais recente por lead)
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
  AND l.closer_id IS DISTINCT FROM sub.closer_id;

-- Prioridade 2: pipe_confirmacao (para leads sem pipe_propostas)
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
  AND l.closer_id IS DISTINCT FROM sub.closer_id
  AND NOT EXISTS (
    SELECT 1 FROM public.pipe_propostas pp
    WHERE pp.lead_id = l.id AND pp.closer_id IS NOT NULL
  );

-- ============================================================================
-- Unificar sdr_id + closer_id → responsible_id
-- ============================================================================
-- Adiciona responsible_id em todas as tabelas que tinham sdr_id/closer_id.
-- Migra dados: COALESCE(closer_id, sdr_id) para a maioria das tabelas.
-- Atualiza RLS functions para usar responsible_id.
-- NÃO remove sdr_id/closer_id — compatibilidade durante transição.
-- ============================================================================

-- ============================================================
-- 1) ADICIONAR responsible_id EM TODAS AS TABELAS
-- ============================================================

-- leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.leads SET responsible_id = COALESCE(closer_id, sdr_id) WHERE responsible_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_responsible ON public.leads(responsible_id);

-- pipe_whatsapp
ALTER TABLE public.pipe_whatsapp
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.pipe_whatsapp SET responsible_id = sdr_id WHERE responsible_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_responsible ON public.pipe_whatsapp(responsible_id);

-- pipe_confirmacao
ALTER TABLE public.pipe_confirmacao
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.pipe_confirmacao SET responsible_id = COALESCE(closer_id, sdr_id) WHERE responsible_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_responsible ON public.pipe_confirmacao(responsible_id);

-- pipe_propostas
ALTER TABLE public.pipe_propostas
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.pipe_propostas SET responsible_id = closer_id WHERE responsible_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_responsible ON public.pipe_propostas(responsible_id);

-- campanha_leads
ALTER TABLE public.campanha_leads
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.campanha_leads SET responsible_id = COALESCE(closer_id, sdr_id) WHERE responsible_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_campanha_leads_responsible ON public.campanha_leads(responsible_id);

-- upsell_clients
ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.upsell_clients SET responsible_id = closer_id WHERE responsible_id IS NULL;

-- upsell_campanhas
ALTER TABLE public.upsell_campanhas
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.upsell_campanhas SET responsible_id = closer_id WHERE responsible_id IS NULL;

-- upsell_orders
ALTER TABLE public.upsell_orders
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
UPDATE public.upsell_orders SET responsible_id = closer_id WHERE responsible_id IS NULL;

-- ============================================================
-- 2) FUNÇÕES RLS — is_user_responsible com responsible_id
-- ============================================================

-- Nova versão single-param para responsible_id
CREATE OR REPLACE FUNCTION public.is_user_responsible(p_responsible_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
    AND id = p_responsible_id
  );
$$;

-- Manter versão legada (3 params) para compatibilidade com policies existentes
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
  (p_assigned_to IS NOT NULL AND p_assigned_to = auth.uid());
$$;

-- Atualizar has_no_responsible para incluir responsible_id
CREATE OR REPLACE FUNCTION public.has_no_responsible(
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
  SELECT p_sdr_id IS NULL AND p_closer_id IS NULL AND p_assigned_to IS NULL;
$$;

-- Atualizar is_user_responsible_in_any_pipe para usar responsible_id
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
        AND (pc.responsible_id = tm.id OR pc.closer_id = tm.id OR pc.sdr_id = tm.id)
      )
      OR EXISTS (
        SELECT 1 FROM public.pipe_propostas pp
        WHERE pp.lead_id = p_lead_id
        AND (pp.responsible_id = tm.id OR pp.closer_id = tm.id)
      )
      OR EXISTS (
        SELECT 1 FROM public.pipe_whatsapp pw
        WHERE pw.lead_id = p_lead_id
        AND (pw.responsible_id = tm.id OR pw.sdr_id = tm.id)
      )
    )
  )
$$;

-- Atualizar can_see_lead_by_permissions para considerar responsible_id
CREATE OR REPLACE FUNCTION public.can_see_lead_by_permissions(
  p_sdr_id UUID,
  p_closer_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Direto: é responsável pelo lead
    public.is_user_responsible(p_sdr_id, p_closer_id, NULL)
    -- Sem responsável + permissão para ver não-atribuídos
    OR (
      public.has_no_responsible(p_sdr_id, p_closer_id, NULL)
      AND public.user_has_org_permission('see_unassigned_cards')
    )
    -- Mesma org + permissão para ver geral
    OR (
      public.is_responsible_in_same_org(p_sdr_id, p_closer_id)
      AND public.user_has_org_permission('see_general_info')
    );
$$;

-- ============================================================
-- 3) TRIGGER: sincronizar responsible_id de pipes → leads
-- ============================================================

-- Trigger unificado para sincronizar responsible_id
CREATE OR REPLACE FUNCTION public.sync_responsible_to_lead_from_pipe()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.responsible_id IS NOT NULL THEN
    UPDATE public.leads
    SET responsible_id = NEW.responsible_id,
        updated_at = NOW()
    WHERE id = NEW.lead_id
      AND (responsible_id IS NULL OR responsible_id IS DISTINCT FROM NEW.responsible_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Triggers em cada tabela de pipe
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_whatsapp ON public.pipe_whatsapp;
CREATE TRIGGER trg_sync_responsible_to_lead_from_pipe_whatsapp
  AFTER INSERT OR UPDATE OF responsible_id ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_responsible_to_lead_from_pipe();

DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_confirmacao ON public.pipe_confirmacao;
CREATE TRIGGER trg_sync_responsible_to_lead_from_pipe_confirmacao
  AFTER INSERT OR UPDATE OF responsible_id ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_responsible_to_lead_from_pipe();

DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_propostas ON public.pipe_propostas;
CREATE TRIGGER trg_sync_responsible_to_lead_from_pipe_propostas
  AFTER INSERT OR UPDATE OF responsible_id ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_responsible_to_lead_from_pipe();

-- ============================================================
-- 4) ATUALIZAR POLICIES DE leads PARA CONSIDERAR responsible_id
-- ============================================================

-- SELECT
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
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  );

-- UPDATE
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
      OR public.is_user_responsible(responsible_id)
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
-- 5) VERIFY: Contagens de audit
-- ============================================================
DO $$
DECLARE
  v_leads_with_responsible INT;
  v_leads_total INT;
BEGIN
  SELECT count(*) INTO v_leads_total FROM public.leads;
  SELECT count(*) INTO v_leads_with_responsible FROM public.leads WHERE responsible_id IS NOT NULL;
  RAISE NOTICE 'leads: %/% com responsible_id preenchido', v_leads_with_responsible, v_leads_total;
END $$;

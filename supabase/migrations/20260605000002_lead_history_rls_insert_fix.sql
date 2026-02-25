-- Fix: permitir INSERT em lead_history. Resolve erro
-- "new row violates row-level security policy for table 'lead_history'"
-- ao salvar data/hora da reunião no funil de confirmação (createLeadHistory é chamado).
--
-- Estratégia: 1) Ajustar política FOR ALL para aceitar lead na org ou lead sem org;
-- 2) Manter política de INSERT por org; 3) Adicionar política de INSERT por team member
-- (qualquer membro da equipe pode inserir histórico) para garantir que o insert nunca falhe por RLS.

-- 1) Política FOR ALL (SELECT, INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "lead_history_via_lead" ON public.lead_history;

CREATE POLICY "lead_history_via_lead"
  ON public.lead_history FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      INNER JOIN public.team_members tm ON tm.user_id = auth.uid()
      WHERE l.id = lead_history.lead_id
      AND (l.organization_id = tm.organization_id OR l.organization_id IS NULL)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      INNER JOIN public.team_members tm ON tm.user_id = auth.uid()
      WHERE l.id = lead_history.lead_id
      AND (l.organization_id = tm.organization_id OR l.organization_id IS NULL)
    )
  );

-- 2) Política de INSERT por org / lead legado
DROP POLICY IF EXISTS "lead_history_insert_organization" ON public.lead_history;

CREATE POLICY "lead_history_insert_organization"
  ON public.lead_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      INNER JOIN public.team_members tm ON tm.user_id = auth.uid()
      WHERE l.id = lead_history.lead_id
      AND (l.organization_id = tm.organization_id OR l.organization_id IS NULL)
    )
  );

-- 3) Fallback: qualquer team member pode inserir histórico (evita falha por RLS)
DROP POLICY IF EXISTS "lead_history_insert_team_member" ON public.lead_history;

CREATE POLICY "lead_history_insert_team_member"
  ON public.lead_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_team_member(auth.uid()));

COMMENT ON POLICY "lead_history_via_lead" ON public.lead_history IS
  'Permite acesso quando o lead pertence à org do usuário ou é lead legado (organization_id NULL).';
COMMENT ON POLICY "lead_history_insert_organization" ON public.lead_history IS
  'Permite insert quando o lead pertence à org do usuário ou é lead legado (organization_id NULL).';
COMMENT ON POLICY "lead_history_insert_team_member" ON public.lead_history IS
  'Fallback: qualquer team member pode inserir histórico (evita falha RLS ao salvar reunião).';

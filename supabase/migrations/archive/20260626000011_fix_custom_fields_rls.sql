-- ============================================
-- FIX: Corrigir políticas RLS de lead_custom_fields e lead_custom_field_values
-- ============================================
-- Data: 2026-02-26
-- Problema: As tabelas lead_custom_fields e lead_custom_field_values foram criadas
-- na migração 20260125030000 com políticas RLS usando subquery direta na team_members.
-- A migração de segurança 20260130000000 atualizou todas as outras tabelas para usar
-- a função get_user_organization_id(), mas ESQUECEU estas duas tabelas.
-- Resultado: Usuários master/org-switch não conseguem ver campos personalizados na UI.
-- ============================================

-- 1. Remover TODAS as políticas (antigas + novas caso existam de execução parcial)
DROP POLICY IF EXISTS "Users can view their org custom fields" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "Users can manage their org custom fields" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "Users can view values for their org leads" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "Users can manage values for their org leads" ON public.lead_custom_field_values;

-- Limpar políticas novas caso execução anterior tenha sido parcial
DROP POLICY IF EXISTS "lead_custom_fields_select_organization" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "lead_custom_fields_insert_organization" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "lead_custom_fields_update_organization" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "lead_custom_fields_delete_organization" ON public.lead_custom_fields;
DROP POLICY IF EXISTS "lead_custom_field_values_select_organization" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "lead_custom_field_values_insert_organization" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "lead_custom_field_values_update_organization" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "lead_custom_field_values_delete_organization" ON public.lead_custom_field_values;

-- 2. Criar novas políticas para lead_custom_fields (usando get_user_organization_id)
CREATE POLICY "lead_custom_fields_select_organization"
  ON public.lead_custom_fields FOR SELECT
  TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "lead_custom_fields_insert_organization"
  ON public.lead_custom_fields FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "lead_custom_fields_update_organization"
  ON public.lead_custom_fields FOR UPDATE
  TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "lead_custom_fields_delete_organization"
  ON public.lead_custom_fields FOR DELETE
  TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 3. Criar novas políticas para lead_custom_field_values (via lead → organization)
CREATE POLICY "lead_custom_field_values_select_organization"
  ON public.lead_custom_field_values FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_custom_field_values.lead_id
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "lead_custom_field_values_insert_organization"
  ON public.lead_custom_field_values FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_custom_field_values.lead_id
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "lead_custom_field_values_update_organization"
  ON public.lead_custom_field_values FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_custom_field_values.lead_id
      AND leads.organization_id = public.get_user_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_custom_field_values.lead_id
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "lead_custom_field_values_delete_organization"
  ON public.lead_custom_field_values FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_custom_field_values.lead_id
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- Log
DO $$
BEGIN
  RAISE NOTICE 'RLS policies for lead_custom_fields and lead_custom_field_values updated to use get_user_organization_id()';
END $$;

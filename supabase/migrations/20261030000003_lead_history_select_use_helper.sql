-- =============================================================================
-- Fix: lead_history_select_by_lead — substituir inline team_members subquery
-- por helper SECURITY DEFINER get_my_organization_ids()
-- Issue: #291 (PRD #284 — Modal Lead v2, Fase 3 realtime)
-- Date: 2026-10-30 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Audit das 6 tabelas que o futuro useLeadDetailRealtime vai subscriba:
--
--   | Tabela              | Status | Migration mais recente das policies      |
--   | leads               | 🟢      | 20261020 (get_my_organization_ids)        |
--   | lead_comments       | 🟢      | 20261023 (get_user_organization_id)       |
--   | lead_tags           | 🟢      | 20261029 (lead_in_my_org helper)          |
--   | pipeline_entries    | 🟢      | 20261020 (get_my_organization_ids)        |
--   | pipe_proposta_items | 🟢      | 20261021 (get_my_organization_ids)        |
--   | lead_history        | 🔴      | 20260917 — inline team_members subquery   |
--
-- A policy vigente de SELECT em lead_history (`lead_history_select_by_lead`,
-- criada em 20260917) faz:
--
--   USING (
--     lead_id IN (
--       SELECT id FROM public.leads
--       WHERE organization_id IN (
--         SELECT organization_id FROM public.team_members
--         WHERE user_id = auth.uid() AND is_active = true
--       )
--       AND (...permissions...)
--     )
--   )
--
-- Quando o Realtime avalia `apply_rls()` em postgres_changes do canal
-- lead_history, a subquery inline em `team_members` dispara avaliação RLS
-- recursiva (team_members RLS → get_my_organization_ids → team_members
-- RLS → ...) e a query nunca completa. Fix conhecido: trocar pelo helper
-- SECURITY DEFINER que bypassa RLS na leitura de team_members.
--
-- Demais policies de lead_history (INSERT/UPDATE/DELETE) já usam
-- get_user_organization_id() / is_user_admin() (migrations 20261016, 20260719).
-- Apenas SELECT precisa de fix.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY.

DROP POLICY IF EXISTS "lead_history_select_by_lead" ON public.lead_history;

CREATE POLICY "lead_history_select_by_lead"
  ON public.lead_history FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (SELECT public.get_my_organization_ids())
        AND (
          public.is_user_admin()
          OR public.has_feature_permission('leads.view_all', organization_id)
          OR public.can_see_lead_by_permissions(sdr_id, closer_id)
          OR public.can_see_lead_by_team_member_permissions(
               organization_id, 'leads', sdr_id, closer_id
             )
          OR public.is_user_responsible_in_any_pipe(id)
        )
    )
  );

COMMENT ON POLICY "lead_history_select_by_lead" ON public.lead_history IS
  'SELECT visibility espelha a policy de leads. Usa get_my_organization_ids() SECURITY DEFINER pra evitar recursão RLS quando Realtime avalia apply_rls() (gotcha do CLAUDE.md raiz, PRD #284 issue #291).';

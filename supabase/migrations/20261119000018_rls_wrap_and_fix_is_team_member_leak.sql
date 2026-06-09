-- 20261119000018_rls_wrap_and_fix_is_team_member_leak.sql
--
-- Variação B (RLS na raiz). Aplicado em prod (jsjsm) 2026-06-09.
--
-- PARTE 1 — RLS InitPlan wrap em massa (auth_rls_initplan 332 → 6):
--   765 policies tiveram auth.uid()/auth.role()/auth.jwt()/is_master_user()/
--   is_user_admin()/get_user_organization_id() bare envolvidos em (SELECT fn())
--   (avalia 1x/statement em vez de por linha). Feito operacionalmente via
--   procedure com COMMIT por policy + lock_timeout (evita lock storm em 213
--   tabelas). Semanticamente IDÊNTICO — não muda acesso. + whatsapp_messages_update_org
--   (escapou da 1ª rodada). Os 6 residuais do advisor são falsos-positivos
--   (has_role(auth.uid()) já dentro de wrap).
--   Em dev/fresh-apply, rodar o wrap via o mesmo procedimento (não incluído aqui
--   p/ não duplicar-wrap em prod já feito).
--
-- PARTE 2 — FIX de VAZAMENTO CROSS-TENANT pré-existente (descoberto no smoke test):
--   is_team_member(uid) = TRUE se membro de QUALQUER org (sem escopo). Policies
--   is_team_member(auth.uid()) davam acesso cross-tenant. Membro não-master via
--   904 follow_ups (892 de outras orgs). Ver [[project_rls_is_team_member_leak]].

-- custom_pipelines + filhas: única via não-master era a vazada → org-scope.
ALTER POLICY "Team members podem gerenciar custom pipelines" ON public.custom_pipelines
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));
ALTER POLICY "Team members podem gerenciar custom pipe entries" ON public.custom_pipe_entries
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));
ALTER POLICY "Team members podem gerenciar custom pipe transitions" ON public.custom_pipe_transitions
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));
ALTER POLICY "Team members podem gerenciar custom pipeline stages" ON public.custom_pipeline_stages
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

-- follow_ups + lead_history: têm policies org-scoped alternativas → dropar as vazadas.
DROP POLICY IF EXISTS "Follow ups visíveis para autenticados" ON public.follow_ups;
DROP POLICY IF EXISTS "Team members podem gerenciar follow ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Team members podem inserir histórico" ON public.lead_history;

-- 20260609120100_rls_wrap_initplan_hot_tables.sql
--
-- RLS InitPlan optimization (Supabase advisor: auth_rls_initplan) nas hot tables.
--
-- Problema: funções STABLE/auth chamadas "bare" no USING/WITH CHECK são avaliadas
-- POR LINHA examinada. Em whatsapp_messages, com ~5000 linhas varridas por página,
-- is_master_user()/is_user_admin()/get_user_organization_id()/auth.role() rodam
-- ~5000x por request. Medido em prod: mesma página = 330ms (service_role, sem RLS
-- de usuário) vs 1560ms (authenticated) = ~4.7x de overhead só de RLS.
--
-- Fix: envolver a chamada em (select fn()). Postgres promove a um InitPlan,
-- materializado UMA vez por statement. Semanticamente IDÊNTICO (mesma função,
-- mesmo resultado) — só muda QUANDO roda.
--
-- Regra aplicada: só envolvo funções SEM argumento de coluna da linha.
--   Envolvidas: is_master_user(), is_user_admin(), get_user_organization_id(),
--               auth.role(), auth.uid(), has_role(auth.uid(),...),
--               user_has_org_permission('...').
--   NÃO envolvidas (dependem de coluna da linha, são genuinamente per-row):
--               is_user_responsible(..., assigned_to/responsible_ids),
--               has_no_responsible(...), has_feature_permission(..., organization_id),
--               can_see_lead_by_permissions(sdr_id, closer_id),
--               is_user_responsible_in_any_pipe(id).
--   Já otimizadas (mantidas): get_my_organization_ids(), get_my_admin_organization_ids()
--               (já em SELECT ...).
--
-- ALTER POLICY preserva nome/cmd/roles/permissive — só reescreve a expressão.
-- Tudo numa transação: se UMA falhar, reverte todas.
-- Reverter: re-aplicar as definições originais (sem o (select ...)).
--
-- ATENÇÃO hot-apply em prod sob carga: ALTER POLICY pega AccessExclusiveLock.
-- Em prod (2026-06-09) esta migration foi aplicada UMA TABELA POR TRANSAÇÃO com
-- SET lock_timeout='20s'. A versão single-transaction abaixo DEADLOCKA sob carga
-- (sync de realtime.subscription via DDL em tabela publicada + storm de leituras).
-- Em DB vazio/dev aplica atômico normalmente. Re-aplicar em prod quente: rodar
-- cada bloco de tabela isolado com lock_timeout. Já registrada como aplicada em
-- supabase_migrations.schema_migrations (version 20261119000011).
--
-- QA obrigatório pós-apply: smoke test SELECT/UPDATE como admin, membro e master
-- em cada tabela, confirmando que o conjunto de linhas visível NÃO mudou.

BEGIN;

-- ── conversation_messages ───────────────────────────────────────────────────
ALTER POLICY conversation_messages_service_role_full_access ON public.conversation_messages
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

ALTER POLICY master_ghost_all_conversation_messages ON public.conversation_messages
  USING ((select is_master_user()))
  WITH CHECK ((select is_master_user()));

ALTER POLICY conv_messages_select_org ON public.conversation_messages
  USING ((conversation_id IN ( SELECT conversations.id
     FROM conversations
    WHERE (conversations.organization_id = (select get_user_organization_id())))));

ALTER POLICY conversation_messages_select_by_conversation ON public.conversation_messages
  USING ((conversation_id IN ( SELECT conversations.id
     FROM conversations
    WHERE ((conversations.organization_id IN ( SELECT team_members.organization_id
             FROM team_members
            WHERE (team_members.user_id = (select auth.uid())))) AND ((select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, conversations.assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, conversations.assigned_to))))));

ALTER POLICY master_ghost_select_conversation_messages ON public.conversation_messages
  USING ((select is_master_user()));

-- ── conversations ───────────────────────────────────────────────────────────
ALTER POLICY conversations_service_role_full_access ON public.conversations
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

ALTER POLICY master_all_conversations ON public.conversations
  USING ((select is_master_user()));

ALTER POLICY conversations_insert_admin_service ON public.conversations
  WITH CHECK ((((select auth.role()) = 'service_role'::text) OR ((select is_user_admin()) AND (organization_id IN ( SELECT team_members.organization_id
     FROM team_members
    WHERE (team_members.user_id = (select auth.uid())))))));

ALTER POLICY conversations_select_by_responsibility ON public.conversations
  USING (((organization_id IN ( SELECT team_members.organization_id
     FROM team_members
    WHERE (team_members.user_id = (select auth.uid())))) AND ((select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to))));

ALTER POLICY conversations_select_org ON public.conversations
  USING ((organization_id = (select get_user_organization_id())));

ALTER POLICY master_select_all_conversations ON public.conversations
  USING ((select is_master_user()));

ALTER POLICY conversations_update_by_responsibility ON public.conversations
  USING (((organization_id IN ( SELECT team_members.organization_id
     FROM team_members
    WHERE (team_members.user_id = (select auth.uid())))) AND (((select auth.role()) = 'service_role'::text) OR (select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to))))
  WITH CHECK (((organization_id IN ( SELECT team_members.organization_id
     FROM team_members
    WHERE (team_members.user_id = (select auth.uid())))) AND (((select auth.role()) = 'service_role'::text) OR (select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to))));

-- ── leads ───────────────────────────────────────────────────────────────────
ALTER POLICY master_all_leads ON public.leads
  USING (((deleted_at IS NULL) AND (select is_master_user())));

ALTER POLICY leads_delete_admin_or_permission ON public.leads
  USING (((deleted_at IS NULL) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND ((select is_user_admin()) OR (select is_master_user()) OR (select user_has_org_permission('can_delete_leads'::text)))));

-- leads_insert_organization: já otimizada (get_my_organization_ids em SELECT) — sem mudança.

ALTER POLICY leads_select_by_responsibility_and_permissions ON public.leads
  USING (((deleted_at IS NULL) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND ((select is_user_admin()) OR has_feature_permission('leads.view_all'::text, organization_id) OR is_user_responsible(pre_sale_responsible_id, sale_responsible_id) OR can_see_lead_by_permissions(sdr_id, closer_id) OR is_user_responsible_in_any_pipe(id))));

ALTER POLICY master_select_all_leads ON public.leads
  USING (((deleted_at IS NULL) AND (select is_master_user())));

ALTER POLICY leads_update_by_responsibility_and_permissions ON public.leads
  USING (((deleted_at IS NULL) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND ((select is_user_admin()) OR has_feature_permission('leads.view_all'::text, organization_id) OR is_user_responsible(pre_sale_responsible_id, sale_responsible_id) OR can_see_lead_by_permissions(sdr_id, closer_id) OR is_user_responsible_in_any_pipe(id))));

-- ── team_members ────────────────────────────────────────────────────────────
ALTER POLICY master_all_team_members ON public.team_members
  USING ((select is_master_user()));

-- team_members_delete/insert/update_admin_org + select_organization: já otimizadas — sem mudança.

ALTER POLICY master_select_all_team_members ON public.team_members
  USING ((select is_master_user()));

ALTER POLICY team_members_select_own ON public.team_members
  USING ((user_id = (select auth.uid())));

-- ── user_roles ──────────────────────────────────────────────────────────────
ALTER POLICY master_all_user_roles ON public.user_roles
  USING ((select is_master_user()));

ALTER POLICY "Apenas admins podem deletar roles" ON public.user_roles
  USING ((select has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Apenas admins podem inserir roles" ON public.user_roles
  WITH CHECK ((select has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY master_select_all_user_roles ON public.user_roles
  USING ((select is_master_user()));

ALTER POLICY user_roles_select_org_admin ON public.user_roles
  USING (((select is_master_user()) OR (user_id IN ( SELECT tm.user_id
     FROM team_members tm
    WHERE (tm.organization_id IN ( SELECT get_my_admin_organization_ids() AS get_my_admin_organization_ids))))));

ALTER POLICY user_roles_select_self ON public.user_roles
  USING ((user_id = (select auth.uid())));

-- ── whatsapp_messages ───────────────────────────────────────────────────────
ALTER POLICY master_all_whatsapp_messages ON public.whatsapp_messages
  USING ((select is_master_user()));

ALTER POLICY whatsapp_messages_service_role_full_access ON public.whatsapp_messages
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

ALTER POLICY whatsapp_messages_insert_admin_service ON public.whatsapp_messages
  WITH CHECK ((((select auth.role()) = 'service_role'::text) OR ((select is_user_admin()) AND (organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)))));

ALTER POLICY whatsapp_messages_insert_org ON public.whatsapp_messages
  WITH CHECK ((organization_id = (select get_user_organization_id())));

ALTER POLICY master_select_all_whatsapp_messages ON public.whatsapp_messages
  USING ((select is_master_user()));

ALTER POLICY whatsapp_messages_select_by_responsibility ON public.whatsapp_messages
  USING (((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND ((select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to))));

ALTER POLICY whatsapp_messages_select_org ON public.whatsapp_messages
  USING ((organization_id = (select get_user_organization_id())));

ALTER POLICY whatsapp_messages_update_by_responsibility ON public.whatsapp_messages
  USING (((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND (((select auth.role()) = 'service_role'::text) OR (select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to))))
  WITH CHECK (((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND (((select auth.role()) = 'service_role'::text) OR (select is_user_admin()) OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to) OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to))));

ALTER POLICY whatsapp_messages_update_org ON public.whatsapp_messages
  USING ((organization_id = (select get_user_organization_id())));

COMMIT;

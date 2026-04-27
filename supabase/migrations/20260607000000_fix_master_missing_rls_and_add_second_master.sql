-- ============================================================
-- Fix: Master RLS policies para tabelas criadas após 20260131
-- + Adicionar segundo usuário master
--
-- Problema: 12 tabelas criadas em migrations posteriores não
-- receberam as policies master_all / master_select_all,
-- bloqueando o usuário master de acessar dados críticos como
-- upsell, badges, mkt, google calendar, etc.
--
-- Também: insere Milennialswebservices@gmail.com como master
-- com permissões equivalentes ao master principal.
-- ============================================================

-- ============================================================
-- 1. UPSELL MODULE (20260500000000_upsell_module.sql)
-- ============================================================

-- upsell_clients
DROP POLICY IF EXISTS "master_select_all_upsell_clients" ON public.upsell_clients;
DROP POLICY IF EXISTS "master_all_upsell_clients"        ON public.upsell_clients;
CREATE POLICY "master_select_all_upsell_clients"
  ON public.upsell_clients FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_upsell_clients"
  ON public.upsell_clients FOR ALL
  USING (public.is_master_user());

-- upsell_client_products
DROP POLICY IF EXISTS "master_select_all_upsell_client_products" ON public.upsell_client_products;
DROP POLICY IF EXISTS "master_all_upsell_client_products"        ON public.upsell_client_products;
CREATE POLICY "master_select_all_upsell_client_products"
  ON public.upsell_client_products FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_upsell_client_products"
  ON public.upsell_client_products FOR ALL
  USING (public.is_master_user());

-- upsell_campanhas
DROP POLICY IF EXISTS "master_select_all_upsell_campanhas" ON public.upsell_campanhas;
DROP POLICY IF EXISTS "master_all_upsell_campanhas"        ON public.upsell_campanhas;
CREATE POLICY "master_select_all_upsell_campanhas"
  ON public.upsell_campanhas FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_upsell_campanhas"
  ON public.upsell_campanhas FOR ALL
  USING (public.is_master_user());

-- upsell_orders
DROP POLICY IF EXISTS "master_select_all_upsell_orders" ON public.upsell_orders;
DROP POLICY IF EXISTS "master_all_upsell_orders"        ON public.upsell_orders;
CREATE POLICY "master_select_all_upsell_orders"
  ON public.upsell_orders FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_upsell_orders"
  ON public.upsell_orders FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 2. GESTAO SYNC RULES (20260504000000_gestao_sync_rules.sql)
-- ============================================================

-- upsell_gestao_rules
DROP POLICY IF EXISTS "master_select_all_upsell_gestao_rules" ON public.upsell_gestao_rules;
DROP POLICY IF EXISTS "master_all_upsell_gestao_rules"        ON public.upsell_gestao_rules;
CREATE POLICY "master_select_all_upsell_gestao_rules"
  ON public.upsell_gestao_rules FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_upsell_gestao_rules"
  ON public.upsell_gestao_rules FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 3. OUTBOUND ORG TYPE (20260600000000_outbound_org_type.sql)
-- ============================================================

-- client_sidebar_permissions
DROP POLICY IF EXISTS "master_select_all_client_sidebar_permissions" ON public.client_sidebar_permissions;
DROP POLICY IF EXISTS "master_all_client_sidebar_permissions"        ON public.client_sidebar_permissions;
CREATE POLICY "master_select_all_client_sidebar_permissions"
  ON public.client_sidebar_permissions FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_client_sidebar_permissions"
  ON public.client_sidebar_permissions FOR ALL
  USING (public.is_master_user());

-- badges
DROP POLICY IF EXISTS "master_select_all_badges" ON public.badges;
DROP POLICY IF EXISTS "master_all_badges"        ON public.badges;
CREATE POLICY "master_select_all_badges"
  ON public.badges FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_badges"
  ON public.badges FOR ALL
  USING (public.is_master_user());

-- user_badges
DROP POLICY IF EXISTS "master_select_all_user_badges" ON public.user_badges;
DROP POLICY IF EXISTS "master_all_user_badges"        ON public.user_badges;
CREATE POLICY "master_select_all_user_badges"
  ON public.user_badges FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_user_badges"
  ON public.user_badges FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 4. MARKETING ORIGIN (20260602000000_mkt_origin_config.sql)
-- ============================================================

-- mkt_origin_config
DROP POLICY IF EXISTS "master_select_all_mkt_origin_config" ON public.mkt_origin_config;
DROP POLICY IF EXISTS "master_all_mkt_origin_config"        ON public.mkt_origin_config;
CREATE POLICY "master_select_all_mkt_origin_config"
  ON public.mkt_origin_config FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_mkt_origin_config"
  ON public.mkt_origin_config FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 5. GOOGLE CALENDAR (20260606000001_google_calendar_sharing_cache_watch.sql)
-- ============================================================

-- google_calendar_sharing
DROP POLICY IF EXISTS "master_select_all_google_calendar_sharing" ON public.google_calendar_sharing;
DROP POLICY IF EXISTS "master_all_google_calendar_sharing"        ON public.google_calendar_sharing;
CREATE POLICY "master_select_all_google_calendar_sharing"
  ON public.google_calendar_sharing FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_google_calendar_sharing"
  ON public.google_calendar_sharing FOR ALL
  USING (public.is_master_user());

-- google_calendar_events_cache
DROP POLICY IF EXISTS "master_select_all_google_calendar_events_cache" ON public.google_calendar_events_cache;
DROP POLICY IF EXISTS "master_all_google_calendar_events_cache"        ON public.google_calendar_events_cache;
CREATE POLICY "master_select_all_google_calendar_events_cache"
  ON public.google_calendar_events_cache FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_google_calendar_events_cache"
  ON public.google_calendar_events_cache FOR ALL
  USING (public.is_master_user());

-- google_calendar_watch_channels
DROP POLICY IF EXISTS "master_select_all_google_calendar_watch_channels" ON public.google_calendar_watch_channels;
DROP POLICY IF EXISTS "master_all_google_calendar_watch_channels"        ON public.google_calendar_watch_channels;
CREATE POLICY "master_select_all_google_calendar_watch_channels"
  ON public.google_calendar_watch_channels FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_google_calendar_watch_channels"
  ON public.google_calendar_watch_channels FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 6. GOOGLE CALENDAR TOKENS (tabela existente, verificação extra)
-- ============================================================

-- google_calendar_tokens (criada antes, mas verificar se tem policy master)
DROP POLICY IF EXISTS "master_select_all_google_calendar_tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "master_all_google_calendar_tokens"        ON public.google_calendar_tokens;
CREATE POLICY "master_select_all_google_calendar_tokens"
  ON public.google_calendar_tokens FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_google_calendar_tokens"
  ON public.google_calendar_tokens FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 7. PIPELINE STAGES (se não tiver policy master)
-- ============================================================

DROP POLICY IF EXISTS "master_select_all_pipeline_stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "master_all_pipeline_stages"        ON public.pipeline_stages;
CREATE POLICY "master_select_all_pipeline_stages"
  ON public.pipeline_stages FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_pipeline_stages"
  ON public.pipeline_stages FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 8. LEAD HISTORY (se não tiver policy master)
-- ============================================================

DROP POLICY IF EXISTS "master_select_all_lead_history" ON public.lead_history;
DROP POLICY IF EXISTS "master_all_lead_history"        ON public.lead_history;
CREATE POLICY "master_select_all_lead_history"
  ON public.lead_history FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_lead_history"
  ON public.lead_history FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 9. COPILOT TABELAS SECUNDÁRIAS (faqs, kanban_rules, followup, docs)
--    copilot_agents já tem policy master desde 20260131200001
-- ============================================================

-- copilot_agent_faqs
DROP POLICY IF EXISTS "master_select_all_copilot_agent_faqs" ON public.copilot_agent_faqs;
DROP POLICY IF EXISTS "master_all_copilot_agent_faqs"        ON public.copilot_agent_faqs;
CREATE POLICY "master_select_all_copilot_agent_faqs"
  ON public.copilot_agent_faqs FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_copilot_agent_faqs"
  ON public.copilot_agent_faqs FOR ALL
  USING (public.is_master_user());

-- copilot_agent_kanban_rules
DROP POLICY IF EXISTS "master_select_all_copilot_agent_kanban_rules" ON public.copilot_agent_kanban_rules;
DROP POLICY IF EXISTS "master_all_copilot_agent_kanban_rules"        ON public.copilot_agent_kanban_rules;
CREATE POLICY "master_select_all_copilot_agent_kanban_rules"
  ON public.copilot_agent_kanban_rules FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_copilot_agent_kanban_rules"
  ON public.copilot_agent_kanban_rules FOR ALL
  USING (public.is_master_user());

-- copilot_agent_followup_rules
DROP POLICY IF EXISTS "master_select_all_copilot_agent_followup_rules" ON public.copilot_agent_followup_rules;
DROP POLICY IF EXISTS "master_all_copilot_agent_followup_rules"        ON public.copilot_agent_followup_rules;
CREATE POLICY "master_select_all_copilot_agent_followup_rules"
  ON public.copilot_agent_followup_rules FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_copilot_agent_followup_rules"
  ON public.copilot_agent_followup_rules FOR ALL
  USING (public.is_master_user());

-- copilot_followup_execution_log
DROP POLICY IF EXISTS "master_select_all_copilot_followup_execution_log" ON public.copilot_followup_execution_log;
DROP POLICY IF EXISTS "master_all_copilot_followup_execution_log"        ON public.copilot_followup_execution_log;
CREATE POLICY "master_select_all_copilot_followup_execution_log"
  ON public.copilot_followup_execution_log FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_copilot_followup_execution_log"
  ON public.copilot_followup_execution_log FOR ALL
  USING (public.is_master_user());

-- copilot_agent_documents
DROP POLICY IF EXISTS "master_select_all_copilot_agent_documents" ON public.copilot_agent_documents;
DROP POLICY IF EXISTS "master_all_copilot_agent_documents"        ON public.copilot_agent_documents;
CREATE POLICY "master_select_all_copilot_agent_documents"
  ON public.copilot_agent_documents FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_copilot_agent_documents"
  ON public.copilot_agent_documents FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 10. TEAM_MEMBER_ORG_PERMISSIONS (se não tiver policy master)
-- ============================================================

DROP POLICY IF EXISTS "master_select_all_team_member_org_permissions" ON public.team_member_org_permissions;
DROP POLICY IF EXISTS "master_all_team_member_org_permissions"        ON public.team_member_org_permissions;
CREATE POLICY "master_select_all_team_member_org_permissions"
  ON public.team_member_org_permissions FOR SELECT
  USING (public.is_master_user());
CREATE POLICY "master_all_team_member_org_permissions"
  ON public.team_member_org_permissions FOR ALL
  USING (public.is_master_user());

-- ============================================================
-- 11. PIPE_CONFIRMACAO (verificar policy adicional para campos novos)
-- ============================================================

-- A tabela pipe_confirmacao já tem policies master, mas garante que
-- o master tem acesso completo inclusive aos campos meet_link adicionados
-- em 20260606000002. Nenhuma ação necessária pois as policies existentes
-- cobrem todos os campos.

-- ============================================================
-- 12. ADICIONAR SEGUNDO USUÁRIO MASTER
--     Email: Milennialswebservices@gmail.com
--
--     NOTA: o usuário deve existir em auth.users (ter feito login).
--     Se ainda não fez login, esta instrução será ignorada
--     pelo ON CONFLICT + WHERE e deve ser re-executada depois.
-- ============================================================

INSERT INTO public.master_users (user_id, notes, permissions)
SELECT
  id,
  'Master secundário - Milennialswebservices@gmail.com',
  '{"all": true}'::jsonb
FROM auth.users
WHERE lower(email) = lower('Milennialswebservices@gmail.com')
ON CONFLICT (user_id) DO UPDATE
  SET is_active   = true,
      permissions = '{"all": true}'::jsonb,
      notes       = 'Master secundário - Milennialswebservices@gmail.com (reativado/atualizado)';

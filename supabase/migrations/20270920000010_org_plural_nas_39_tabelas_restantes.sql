-- A org do usuário vira PLURAL nas 39 tabelas que ainda a resolviam no singular.
--
-- ── POR QUE O NÚMERO É 20270920000010 ───────────────────────────────────────
-- Terceira versão deste arquivo, e as duas anteriores falhariam CALADAS:
--
--   20270917000000 — colidia no repo com `campanha_e_disparo_por_pipeline_id`.
--                    Dois arquivos, mesmo prefixo: `db push` aplica um e pula
--                    o outro sem erro.
--   20270917000010 — livre no repo, mas o ledger de PROD já a usa para
--                    `leitores_leem_o_desfecho` (migration sem arquivo aqui —
--                    outra frente aplica direto). `db push` veria a versão no
--                    ledger, consideraria aplicada e PULARIA.
--   20270920000010 — livre no repo E no ledger. Medido em 2026-09-03: teto do
--                    ledger `20270919000000`, teto do repo `20270920000000`.
--
-- Isto NÃO é detalhe de numeração. Este arquivo tem 88 `CREATE POLICY` sem
-- `IF NOT EXISTS`: versão já no ledger = 39 tabelas seguem com RLS resolvendo
-- a org errada, sem UMA linha de erro. O teto do repo não é o teto do slot
-- livre — conferir o ledger de prod, e conferir de novo no momento do apply.
--
-- ── O DEFEITO, GENERALIZADO ─────────────────────────────────────────────────
-- `get_user_organization_id()` NÃO devolve a org em uso. É:
--
--     SELECT organization_id FROM team_members
--     WHERE user_id = auth.uid() AND is_active
--     ORDER BY created_at ASC, id ASC LIMIT 1
--
-- a org mais ANTIGA do usuário. O front sempre pede pela org selecionada no
-- switcher; a RLS responde pela org antiga. Para quem pertence a UMA org os dois
-- coincidem e nada aparece. Para quem pertence a duas ou mais, a tela fica vazia
-- sem um único erro — e o master, que passa pelas policies `master_ghost_*` sem
-- filtro de org, continua vendo tudo. Daí a assinatura do bug: "no master eu
-- vejo, no cliente não".
--
-- 20270910000000 corrigiu `lead_custom_fields` e o SELECT de
-- `lead_custom_field_values` depois do caso medido na Sampaio e Moraes (João
-- Victor, admin de 5 orgs, recebia 0 de 6 campos). Esta migration termina o
-- serviço: **88 policies em 39 tabelas**, incluindo as duas de ESCRITA que
-- sobraram em `lead_custom_field_values`.
--
-- Entre elas há tabelas que o vendedor usa o dia inteiro:
--   `tags` (a etiqueta que o card do funil desenha), `copilot_agents`,
--   `activities`, `follow_ups`, `contacts`, `companies`, `lead_history`,
--   `saved_views`, `whatsapp_messages`, `deal_contacts`, `lead_scores`.
--
-- ── A TROCA, E SÓ ELA ───────────────────────────────────────────────────────
-- Cada policy passa a resolver o tenant por `get_my_organization_ids()` — o
-- CONJUNTO das orgs do usuário, que é o predicado que `leads`, `deals` e
-- `pipeline_entries` já usavam. Nenhum outro termo foi tocado: quem exigia
-- `is_user_admin()`, `owner_id = auth.uid()`, `is_published`, join com a tabela
-- pai ou `organization_id IS NULL`, continua exigindo, na mesma ordem.
--
-- Três consequências, todas desejadas e todas iguais às da 20270910000000:
--   1. multi-org enxerga a org EM USO (o front já filtra pela selecionada);
--   2. gestor de portfólio passa a alcançar as orgs que gerencia —
--      `get_my_member_organization_ids()` faz UNION com
--      `get_my_gestor_organization_ids()`;
--   3. org com cobrança suspensa/cancelada/expirada SAI do conjunto, porque
--      `get_my_organization_ids()` filtra por `org_access_blocked()`. É aperto,
--      não folga.
--
-- Para `anon` nada muda: o conjunto vem vazio, como `= NULL` já vinha falso.
--
-- ── COMO ESTE ARQUIVO FOI ESCRITO ───────────────────────────────────────────
-- O DDL abaixo foi GERADO a partir do `pg_policies` de produção (2026-09-02) e
-- está aqui literal, statement a statement, para poder ser lido e revisado. Não
-- há `DO` block reescrevendo policy em tempo de execução: um metaprograma que
-- erra o parse de uma expressão de RLS abre ou fecha acesso em silêncio, e é
-- justamente o tipo de coisa que não se descobre no dia do apply.
--
-- O gerador aborta se encontrar uma forma de uso não prevista das duas que o
-- schema tem (`= ( SELECT get_user_organization_id() ...)` e a nua
-- `= get_user_organization_id()`). Nenhuma apareceu: 88 de 88 casaram.
--
-- ⚠️ O QUE ESTA MIGRATION *NÃO* FAZ: a função `has_feature_permission(text)` de
-- um argumento também chama `get_user_organization_id()` por dentro, e é usada
-- por `can_see_lead_by_permissions()`. Mexer nela muda a semântica de todos os
-- chamadores de uma vez e merece a sua própria fatia, com o seu próprio teste.

BEGIN;

DROP POLICY IF EXISTS "activities_delete" ON public."activities";
CREATE POLICY "activities_delete" ON public."activities"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "activities_insert" ON public."activities";
CREATE POLICY "activities_insert" ON public."activities"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "activities_select" ON public."activities";
CREATE POLICY "activities_select" ON public."activities"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "activities_update" ON public."activities";
CREATE POLICY "activities_update" ON public."activities"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "agent_decision_logs_select_org" ON public."agent_decision_logs";
CREATE POLICY "agent_decision_logs_select_org" ON public."agent_decision_logs"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "awards_manage_admin_org" ON public."awards";
CREATE POLICY "awards_manage_admin_org" ON public."awards"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT is_master_user() AS is_master_user))))
  WITH CHECK (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT is_master_user() AS is_master_user))));

DROP POLICY IF EXISTS "awards_select_org" ON public."awards";
CREATE POLICY "awards_select_org" ON public."awards"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "badges_delete_org" ON public."badges";
CREATE POLICY "badges_delete_org" ON public."badges"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "badges_insert_org" ON public."badges";
CREATE POLICY "badges_insert_org" ON public."badges"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "badges_select_org" ON public."badges";
CREATE POLICY "badges_select_org" ON public."badges"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "badges_update_org" ON public."badges";
CREATE POLICY "badges_update_org" ON public."badges"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "client_sidebar_permissions_delete_org" ON public."client_sidebar_permissions";
CREATE POLICY "client_sidebar_permissions_delete_org" ON public."client_sidebar_permissions"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "client_sidebar_permissions_insert_org" ON public."client_sidebar_permissions";
CREATE POLICY "client_sidebar_permissions_insert_org" ON public."client_sidebar_permissions"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "client_sidebar_permissions_select_org" ON public."client_sidebar_permissions";
CREATE POLICY "client_sidebar_permissions_select_org" ON public."client_sidebar_permissions"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "client_sidebar_permissions_update_org" ON public."client_sidebar_permissions";
CREATE POLICY "client_sidebar_permissions_update_org" ON public."client_sidebar_permissions"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "companies_delete" ON public."companies";
CREATE POLICY "companies_delete" ON public."companies"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "companies_insert" ON public."companies";
CREATE POLICY "companies_insert" ON public."companies"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "companies_select" ON public."companies";
CREATE POLICY "companies_select" ON public."companies"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "companies_update" ON public."companies";
CREATE POLICY "companies_update" ON public."companies"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "competition_participants_manage" ON public."competition_participants";
CREATE POLICY "competition_participants_manage" ON public."competition_participants"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((competition_id IN ( SELECT competitions.id
   FROM competitions
  WHERE (competitions.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))))
  WITH CHECK ((competition_id IN ( SELECT competitions.id
   FROM competitions
  WHERE (competitions.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "competition_participants_select" ON public."competition_participants";
CREATE POLICY "competition_participants_select" ON public."competition_participants"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((competition_id IN ( SELECT competitions.id
   FROM competitions
  WHERE (competitions.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "competition_prizes_manage" ON public."competition_prizes";
CREATE POLICY "competition_prizes_manage" ON public."competition_prizes"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((competition_id IN ( SELECT competitions.id
   FROM competitions
  WHERE (competitions.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))))
  WITH CHECK ((competition_id IN ( SELECT competitions.id
   FROM competitions
  WHERE (competitions.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "competition_prizes_select" ON public."competition_prizes";
CREATE POLICY "competition_prizes_select" ON public."competition_prizes"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((competition_id IN ( SELECT competitions.id
   FROM competitions
  WHERE (competitions.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "competitions_manage" ON public."competitions";
CREATE POLICY "competitions_manage" ON public."competitions"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "competitions_select" ON public."competitions";
CREATE POLICY "competitions_select" ON public."competitions"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "contacts_delete" ON public."contacts";
CREATE POLICY "contacts_delete" ON public."contacts"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "contacts_insert" ON public."contacts";
CREATE POLICY "contacts_insert" ON public."contacts"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "contacts_select" ON public."contacts";
CREATE POLICY "contacts_select" ON public."contacts"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (deleted_at IS NULL)));

DROP POLICY IF EXISTS "contacts_update" ON public."contacts";
CREATE POLICY "contacts_update" ON public."contacts"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "users_insert_own_conversation_read_state" ON public."conversation_read_state";
CREATE POLICY "users_insert_own_conversation_read_state" ON public."conversation_read_state"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((( SELECT is_master_user() AS is_master_user) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "users_read_own_conversation_read_state" ON public."conversation_read_state";
CREATE POLICY "users_read_own_conversation_read_state" ON public."conversation_read_state"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT is_master_user() AS is_master_user) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "users_update_own_conversation_read_state" ON public."conversation_read_state";
CREATE POLICY "users_update_own_conversation_read_state" ON public."conversation_read_state"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((( SELECT is_master_user() AS is_master_user) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))))
  WITH CHECK ((( SELECT is_master_user() AS is_master_user) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "copilot_agent_faqs_select_org" ON public."copilot_agent_faqs";
CREATE POLICY "copilot_agent_faqs_select_org" ON public."copilot_agent_faqs"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((agent_id IN ( SELECT copilot_agents.id
   FROM copilot_agents
  WHERE (copilot_agents.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "copilot_kanban_rules_select_org" ON public."copilot_agent_kanban_rules";
CREATE POLICY "copilot_kanban_rules_select_org" ON public."copilot_agent_kanban_rules"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((agent_id IN ( SELECT copilot_agents.id
   FROM copilot_agents
  WHERE (copilot_agents.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "copilot_agents_delete_org" ON public."copilot_agents";
CREATE POLICY "copilot_agents_delete_org" ON public."copilot_agents"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'admin'::app_role))))));

DROP POLICY IF EXISTS "copilot_agents_select_org" ON public."copilot_agents";
CREATE POLICY "copilot_agents_select_org" ON public."copilot_agents"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "copilot_agents_update_org" ON public."copilot_agents";
CREATE POLICY "copilot_agents_update_org" ON public."copilot_agents"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'admin'::app_role))))));

DROP POLICY IF EXISTS "Users can manage pipeline members in their org" ON public."custom_pipeline_members";
CREATE POLICY "Users can manage pipeline members in their org" ON public."custom_pipeline_members"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "Users can view pipeline members in their org" ON public."custom_pipeline_members";
CREATE POLICY "Users can view pipeline members in their org" ON public."custom_pipeline_members"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "deal_contacts_delete" ON public."deal_contacts";
CREATE POLICY "deal_contacts_delete" ON public."deal_contacts"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING ((EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_contacts.deal_id) AND (d.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "deal_contacts_insert" ON public."deal_contacts";
CREATE POLICY "deal_contacts_insert" ON public."deal_contacts"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_contacts.deal_id) AND (d.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "deal_contacts_select" ON public."deal_contacts";
CREATE POLICY "deal_contacts_select" ON public."deal_contacts"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_contacts.deal_id) AND (d.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "deal_contacts_update" ON public."deal_contacts";
CREATE POLICY "deal_contacts_update" ON public."deal_contacts"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING ((EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_contacts.deal_id) AND (d.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "follow_up_automations_select_org" ON public."follow_up_automations";
CREATE POLICY "follow_up_automations_select_org" ON public."follow_up_automations"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "follow_ups_org_direct" ON public."follow_ups";
CREATE POLICY "follow_ups_org_direct" ON public."follow_ups"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "followup_automation_log_org" ON public."followup_automation_log";
CREATE POLICY "followup_automation_log_org" ON public."followup_automation_log"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "goals_manage_admin_org" ON public."goals";
CREATE POLICY "goals_manage_admin_org" ON public."goals"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((is_master_user() OR (is_user_admin() AND (organization_id IN ( SELECT public.get_my_organization_ids())))))
  WITH CHECK ((is_master_user() OR (is_user_admin() AND (organization_id IN ( SELECT public.get_my_organization_ids())))));

DROP POLICY IF EXISTS "goals_select_org" ON public."goals";
CREATE POLICY "goals_select_org" ON public."goals"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((is_master_user() OR (organization_id IN ( SELECT public.get_my_organization_ids()))));

DROP POLICY IF EXISTS "help_articles_admin_read" ON public."help_articles";
CREATE POLICY "help_articles_admin_read" ON public."help_articles"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND ( SELECT is_user_admin() AS is_user_admin)));

DROP POLICY IF EXISTS "help_articles_admin_write" ON public."help_articles";
CREATE POLICY "help_articles_admin_write" ON public."help_articles"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND ( SELECT is_user_admin() AS is_user_admin)))
  WITH CHECK (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND ( SELECT is_user_admin() AS is_user_admin)));

DROP POLICY IF EXISTS "help_articles_read" ON public."help_articles";
CREATE POLICY "help_articles_read" ON public."help_articles"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING (((is_published = true) AND ((organization_id IS NULL) OR (organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))));

DROP POLICY IF EXISTS "help_categories_admin_write" ON public."help_categories";
CREATE POLICY "help_categories_admin_write" ON public."help_categories"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND ( SELECT is_user_admin() AS is_user_admin)))
  WITH CHECK (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND ( SELECT is_user_admin() AS is_user_admin)));

DROP POLICY IF EXISTS "help_categories_read" ON public."help_categories";
CREATE POLICY "help_categories_read" ON public."help_categories"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING (((organization_id IS NULL) OR (organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))));

DROP POLICY IF EXISTS "lead_custom_field_values_delete_organization" ON public."lead_custom_field_values";
CREATE POLICY "lead_custom_field_values_delete_organization" ON public."lead_custom_field_values"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_custom_field_values.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "lead_custom_field_values_insert_organization" ON public."lead_custom_field_values";
CREATE POLICY "lead_custom_field_values_insert_organization" ON public."lead_custom_field_values"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_custom_field_values.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "lead_custom_field_values_update_organization" ON public."lead_custom_field_values";
CREATE POLICY "lead_custom_field_values_update_organization" ON public."lead_custom_field_values"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_custom_field_values.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_custom_field_values.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "lead_history_insert_org" ON public."lead_history";
CREATE POLICY "lead_history_insert_org" ON public."lead_history"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_history.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "lead_scores_all_org" ON public."lead_scores";
CREATE POLICY "lead_scores_all_org" ON public."lead_scores"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_scores.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_scores.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "lead_scores_select_org" ON public."lead_scores";
CREATE POLICY "lead_scores_select_org" ON public."lead_scores"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_scores.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "leads_reativacao_all_org" ON public."leads_reativacao";
CREATE POLICY "leads_reativacao_all_org" ON public."leads_reativacao"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = leads_reativacao.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = leads_reativacao.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "leads_reativacao_select_org" ON public."leads_reativacao";
CREATE POLICY "leads_reativacao_select_org" ON public."leads_reativacao"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = leads_reativacao.lead_id) AND (leads.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "tenant_isolation_select" ON public."meta_asset_bindings";
CREATE POLICY "tenant_isolation_select" ON public."meta_asset_bindings"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids())));

DROP POLICY IF EXISTS "meta_connections_org_access" ON public."meta_connections";
CREATE POLICY "meta_connections_org_access" ON public."meta_connections"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "meta_leadgen_configs_org_access" ON public."meta_leadgen_configs";
CREATE POLICY "meta_leadgen_configs_org_access" ON public."meta_leadgen_configs"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "meta_pages_org_access" ON public."meta_pages";
CREATE POLICY "meta_pages_org_access" ON public."meta_pages"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "order_events_insert_org" ON public."order_events";
CREATE POLICY "order_events_insert_org" ON public."order_events"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "order_events_select_org" ON public."order_events";
CREATE POLICY "order_events_select_org" ON public."order_events"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "product_materials_manage" ON public."product_materials";
CREATE POLICY "product_materials_manage" ON public."product_materials"
  AS PERMISSIVE
  FOR ALL
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "product_materials_select" ON public."product_materials";
CREATE POLICY "product_materials_select" ON public."product_materials"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "product_variants_select_org" ON public."product_variants";
CREATE POLICY "product_variants_select_org" ON public."product_variants"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "retention_suggestions_select_org" ON public."retention_suggestions";
CREATE POLICY "retention_suggestions_select_org" ON public."retention_suggestions"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "saved_views_delete" ON public."saved_views";
CREATE POLICY "saved_views_delete" ON public."saved_views"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (owner_id = ( SELECT auth.uid() AS uid)) AND (is_system = false)));

DROP POLICY IF EXISTS "saved_views_insert" ON public."saved_views";
CREATE POLICY "saved_views_insert" ON public."saved_views"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (owner_id = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS "saved_views_select" ON public."saved_views";
CREATE POLICY "saved_views_select" ON public."saved_views"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR (is_shared = true))));

DROP POLICY IF EXISTS "saved_views_update" ON public."saved_views";
CREATE POLICY "saved_views_update" ON public."saved_views"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (owner_id = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS "tags_delete_admin_only" ON public."tags";
CREATE POLICY "tags_delete_admin_only" ON public."tags"
  AS PERMISSIVE
  FOR DELETE
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT is_master_user() AS is_master_user))));

DROP POLICY IF EXISTS "tags_insert_admin_only" ON public."tags";
CREATE POLICY "tags_insert_admin_only" ON public."tags"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT is_master_user() AS is_master_user))));

DROP POLICY IF EXISTS "tags_select_organization" ON public."tags";
CREATE POLICY "tags_select_organization" ON public."tags"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "tags_update_admin_only" ON public."tags";
CREATE POLICY "tags_update_admin_only" ON public."tags"
  AS PERMISSIVE
  FOR UPDATE
  TO "public"
  USING (((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)) AND (( SELECT is_user_admin() AS is_user_admin) OR ( SELECT is_master_user() AS is_master_user))));

DROP POLICY IF EXISTS "upsell_gestao_rules_delete_org" ON public."upsell_gestao_rules";
CREATE POLICY "upsell_gestao_rules_delete_org" ON public."upsell_gestao_rules"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "upsell_gestao_rules_insert_org" ON public."upsell_gestao_rules";
CREATE POLICY "upsell_gestao_rules_insert_org" ON public."upsell_gestao_rules"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "upsell_gestao_rules_select_org" ON public."upsell_gestao_rules";
CREATE POLICY "upsell_gestao_rules_select_org" ON public."upsell_gestao_rules"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "upsell_gestao_rules_update_org" ON public."upsell_gestao_rules";
CREATE POLICY "upsell_gestao_rules_update_org" ON public."upsell_gestao_rules"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)))
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

DROP POLICY IF EXISTS "user_badges_delete" ON public."user_badges";
CREATE POLICY "user_badges_delete" ON public."user_badges"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM badges
  WHERE ((badges.id = user_badges.badge_id) AND (badges.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "user_badges_insert" ON public."user_badges";
CREATE POLICY "user_badges_insert" ON public."user_badges"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM badges
  WHERE ((badges.id = user_badges.badge_id) AND (badges.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "user_badges_select" ON public."user_badges";
CREATE POLICY "user_badges_select" ON public."user_badges"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM badges
  WHERE ((badges.id = user_badges.badge_id) AND (badges.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "user_badges_update" ON public."user_badges";
CREATE POLICY "user_badges_update" ON public."user_badges"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM badges
  WHERE ((badges.id = user_badges.badge_id) AND (badges.organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids))))));

DROP POLICY IF EXISTS "whatsapp_messages_insert_org" ON public."whatsapp_messages";
CREATE POLICY "whatsapp_messages_insert_org" ON public."whatsapp_messages"
  AS PERMISSIVE
  FOR INSERT
  TO "public"
  WITH CHECK ((organization_id IN ( SELECT public.get_my_organization_ids() AS get_my_organization_ids)));

-- Sobrou alguma? Em prod, não: as 88 foram geradas do próprio `pg_policies`.
-- Num banco FRESCO (o do CI) pode sobrar, se houver drift entre o repo e prod —
-- e é informação que vale ter no log do apply. AVISO, não exceção: derrubar o
-- `supabase start` de todo mundo por causa de drift alheio troca um problema
-- silencioso por um bloqueio geral. Quem reprova de verdade é o pgTAP
-- `org_plural_em_todas_as_policies_test.sql`, cujo estrago fica contido no job.
DO $guarda$
DECLARE
  v_restantes text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    INTO v_restantes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual LIKE '%get_user_organization_id%'
          OR with_check LIKE '%get_user_organization_id%');

  IF v_restantes IS NOT NULL THEN
    RAISE WARNING 'org singular ainda em uso por policy: %', v_restantes;
  END IF;
END
$guarda$;

COMMIT;

-- ============================================
-- Migration: Otimização de Performance — RLS + Indexes
-- Data: 2026-03-03
-- ============================================
-- O que esta migration faz:
-- 1. Cria função STABLE get_my_org_ids() para cache de org_ids no Postgres
-- 2. Atualiza RLS policies das tabelas mais acessadas para usar funções STABLE
--    em vez de subqueries repetidas (conversations, whatsapp_messages, copilot_agents)
-- 3. Cria indexes faltantes nas tabelas mais consultadas
-- ============================================

-- =============================================
-- FASE 1: Função auxiliar STABLE para org_ids
-- =============================================
-- STABLE = Postgres cacheia o resultado dentro da mesma transação/statement
-- SECURITY DEFINER = roda como owner, bypassando RLS na consulta interna

CREATE OR REPLACE FUNCTION public.get_my_org_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

-- =============================================
-- FASE 2: Atualizar RLS — conversations
-- =============================================
-- Política antiga: subquery aninhada em team_members
-- Política nova: usa get_user_organization_id() (STABLE, já existente)

DROP POLICY IF EXISTS "Users can view conversations from their organization" ON public.conversations;
CREATE POLICY "conversations_select_org" ON public.conversations FOR SELECT
  USING (organization_id = public.get_user_organization_id());

-- =============================================
-- FASE 3: Atualizar RLS — conversation_messages
-- =============================================
-- Política antiga: subquery dupla (conversation -> team_members)
-- Política nova: subquery simples via conversation -> org function

DROP POLICY IF EXISTS "Users can view messages from conversations in their organization" ON public.conversation_messages;
CREATE POLICY "conv_messages_select_org" ON public.conversation_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE organization_id = public.get_user_organization_id()
    )
  );

-- =============================================
-- FASE 4: Atualizar RLS — agent_decision_logs
-- =============================================

DROP POLICY IF EXISTS "Users can view decision logs from their organization" ON public.agent_decision_logs;
CREATE POLICY "agent_decision_logs_select_org" ON public.agent_decision_logs FOR SELECT
  USING (organization_id = public.get_user_organization_id());

-- =============================================
-- FASE 5: Atualizar RLS — whatsapp_messages
-- =============================================
-- 3 políticas com subquery aninhada em team_members

DROP POLICY IF EXISTS "Users can view messages from their organization" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_select_org" ON public.whatsapp_messages FOR SELECT
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "Users can insert messages in their organization" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_insert_org" ON public.whatsapp_messages FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "Users can update messages in their organization" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_update_org" ON public.whatsapp_messages FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

-- =============================================
-- FASE 6: Atualizar RLS — copilot_agents
-- =============================================

DROP POLICY IF EXISTS "Users can view agents from their organization" ON public.copilot_agents;
CREATE POLICY "copilot_agents_select_org" ON public.copilot_agents FOR SELECT
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "Admins can update agents from their organization" ON public.copilot_agents;
CREATE POLICY "copilot_agents_update_org" ON public.copilot_agents FOR UPDATE
  USING (
    organization_id = public.get_user_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete agents from their organization" ON public.copilot_agents;
CREATE POLICY "copilot_agents_delete_org" ON public.copilot_agents FOR DELETE
  USING (
    organization_id = public.get_user_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================
-- FASE 7: Atualizar RLS — copilot_agent_faqs
-- =============================================

DROP POLICY IF EXISTS "Users can view FAQs from agents in their organization" ON public.copilot_agent_faqs;
CREATE POLICY "copilot_agent_faqs_select_org" ON public.copilot_agent_faqs FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "Admins can manage FAQs" ON public.copilot_agent_faqs;
CREATE POLICY "copilot_agent_faqs_all_org" ON public.copilot_agent_faqs FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id = public.get_user_organization_id()
    )
  );

-- =============================================
-- FASE 8: Atualizar RLS — copilot_agent_kanban_rules
-- =============================================

DROP POLICY IF EXISTS "Users can view Kanban rules from agents in their organization" ON public.copilot_agent_kanban_rules;
CREATE POLICY "copilot_kanban_rules_select_org" ON public.copilot_agent_kanban_rules FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "Admins can manage Kanban rules" ON public.copilot_agent_kanban_rules;
CREATE POLICY "copilot_kanban_rules_all_org" ON public.copilot_agent_kanban_rules FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id = public.get_user_organization_id()
    )
  );

-- =============================================
-- FASE 9: INDEXES para tabelas mais acessadas
-- =============================================
-- Nota: CONCURRENTLY não pode ser usado dentro de uma transação (migration).
-- Por isso usamos CREATE INDEX IF NOT EXISTS (sem CONCURRENTLY).
-- Em produção, se a tabela for muito grande, rode esses indexes manualmente
-- no SQL Editor com CONCURRENTLY fora de uma transação.

-- whatsapp_messages: queries por org + direction + timestamp (chat inbox)
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_org_dir_ts
  ON public.whatsapp_messages(organization_id, direction, "timestamp" DESC);

-- whatsapp_messages: queries por org + instance_id + phone (chat individual)
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_org_instance_phone
  ON public.whatsapp_messages(organization_id, instance_id, phone_number, "timestamp" DESC);

-- scheduled_campaign_messages: processamento de campanhas agendadas
CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_status_scheduled
  ON public.scheduled_campaign_messages(status, scheduled_at)
  WHERE status = 'pending';

-- lead_memories: busca por lead + importância (long-term memory)
CREATE INDEX IF NOT EXISTS idx_lead_memories_lead_importance
  ON public.lead_memories(lead_id, importance DESC);

-- conversations: busca por lead_id (muito usada no AgentEngine)
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id
  ON public.conversations(lead_id);

-- conversations: busca por org + estado + última mensagem (inbox)
CREATE INDEX IF NOT EXISTS idx_conversations_org_state_lastmsg
  ON public.conversations(organization_id, state, last_message_at DESC);

-- copilot_conversation_evaluations: busca por conversation_id
CREATE INDEX IF NOT EXISTS idx_copilot_evals_conversation
  ON public.copilot_conversation_evaluations(conversation_id);

-- pipe_confirmacao: org + status (dashboard metrics)
CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_org_status
  ON public.pipe_confirmacao(organization_id, status);

-- pipe_propostas: org + status (dashboard metrics)
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_org_status
  ON public.pipe_propostas(organization_id, status);

-- leads: org + created_at (listagem ordenada)
CREATE INDEX IF NOT EXISTS idx_leads_org_created
  ON public.leads(organization_id, created_at DESC);

-- =============================================
-- FASE 10: Garantir que função get_user_organization_id() é STABLE
-- =============================================
-- Re-criar com hint STABLE caso a versão original não tenha

CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

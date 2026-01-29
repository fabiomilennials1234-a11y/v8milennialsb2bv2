-- Migration: Add User Separation Complete - Multi-tenant
-- Description: Implementa separação completa de dados por usuário responsável
-- Admins veem tudo, usuários veem apenas onde são responsáveis, itens sem responsável são visíveis para todos
-- Date: 2026-01-28

-- =====================================================
-- PARTE 1: ADICIONAR CAMPOS FALTANTES
-- =====================================================

-- Adicionar assigned_to em conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Adicionar assigned_to em whatsapp_messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to 
  ON public.conversations(assigned_to) 
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_assigned_to 
  ON public.whatsapp_messages(assigned_to) 
  WHERE assigned_to IS NOT NULL;

-- =====================================================
-- PARTE 2: FUNÇÃO AUXILIAR PARA VERIFICAR RESPONSABILIDADE
-- =====================================================

-- Função para verificar se usuário é responsável por um item
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
  (p_assigned_to IS NOT NULL AND p_assigned_to = auth.uid())
$$;

-- Função auxiliar para verificar se é admin
CREATE OR REPLACE FUNCTION public.is_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
$$;

-- Função auxiliar para verificar se item não tem responsável
CREATE OR REPLACE FUNCTION public.has_no_responsible(
  p_sdr_id UUID,
  p_closer_id UUID,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT (p_sdr_id IS NULL AND p_closer_id IS NULL AND p_assigned_to IS NULL)
$$;

-- =====================================================
-- PARTE 3: ATUALIZAR POLÍTICAS RLS - LEADS
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "leads_select_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_insert_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_update_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_organization" ON public.leads;
DROP POLICY IF EXISTS "Team members podem ver leads" ON public.leads;
DROP POLICY IF EXISTS "Team members podem criar leads" ON public.leads;
DROP POLICY IF EXISTS "Team members podem atualizar leads" ON public.leads;
DROP POLICY IF EXISTS "Apenas admins podem excluir leads" ON public.leads;
DROP POLICY IF EXISTS "Leads visíveis para autenticados" ON public.leads;
DROP POLICY IF EXISTS "Team members podem gerenciar leads" ON public.leads;
DROP POLICY IF EXISTS "Users can only see leads from their organization" ON public.leads;
DROP POLICY IF EXISTS "Users can insert leads in their organization" ON public.leads;
DROP POLICY IF EXISTS "Users can update leads in their organization" ON public.leads;
DROP POLICY IF EXISTS "Users can delete leads in their organization" ON public.leads;

-- SELECT: Admins veem tudo, usuários veem apenas onde são responsáveis OU sem responsável
CREATE POLICY "leads_select_by_responsibility"
  ON public.leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      -- Admin vê tudo
      public.is_user_admin()
      OR
      -- Usuário vê onde é responsável
      public.is_user_responsible(sdr_id, closer_id, NULL)
      OR
      -- Todos veem itens sem responsável
      public.has_no_responsible(sdr_id, closer_id, NULL)
    )
  );

-- INSERT: Qualquer usuário da organização pode criar leads
CREATE POLICY "leads_insert_organization"
  ON public.leads FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: Admins podem atualizar qualquer lead da org. Usuários só os seus ou sem responsável.
CREATE POLICY "leads_update_by_responsibility"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, closer_id, NULL)
      OR
      public.has_no_responsible(sdr_id, closer_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, closer_id, NULL)
      OR
      public.has_no_responsible(sdr_id, closer_id, NULL)
    )
  );

-- DELETE: Apenas admins podem deletar
CREATE POLICY "leads_delete_admin_only"
  ON public.leads FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 4: ATUALIZAR POLÍTICAS RLS - PIPE_CONFIRMACAO (REUNIÕES)
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Pipe confirmação visível para autenticados" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "Team members podem gerenciar pipe confirmação" ON public.pipe_confirmacao;

-- SELECT: Admins veem tudo, usuários veem apenas onde são responsáveis OU sem responsável
CREATE POLICY "pipe_confirmacao_select_by_responsibility"
  ON public.pipe_confirmacao FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, closer_id, NULL)
      OR
      public.has_no_responsible(sdr_id, closer_id, NULL)
    )
  );

-- INSERT: Qualquer usuário da organização pode criar reuniões
CREATE POLICY "pipe_confirmacao_insert_organization"
  ON public.pipe_confirmacao FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: Admins podem atualizar qualquer reunião da org. Usuários só as suas ou sem responsável.
CREATE POLICY "pipe_confirmacao_update_by_responsibility"
  ON public.pipe_confirmacao FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, closer_id, NULL)
      OR
      public.has_no_responsible(sdr_id, closer_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, closer_id, NULL)
      OR
      public.has_no_responsible(sdr_id, closer_id, NULL)
    )
  );

-- DELETE: Apenas admins podem deletar reuniões
CREATE POLICY "pipe_confirmacao_delete_admin_only"
  ON public.pipe_confirmacao FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 5: ATUALIZAR POLÍTICAS RLS - PIPE_PROPOSTAS
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Pipe propostas visível para autenticados" ON public.pipe_propostas;
DROP POLICY IF EXISTS "Team members podem gerenciar pipe propostas" ON public.pipe_propostas;

-- SELECT: Admins veem tudo, usuários veem apenas onde são closer_id OU sem responsável
CREATE POLICY "pipe_propostas_select_by_responsibility"
  ON public.pipe_propostas FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, closer_id, NULL)
      OR
      public.has_no_responsible(NULL, closer_id, NULL)
    )
  );

-- INSERT: Qualquer usuário da organização pode criar propostas
CREATE POLICY "pipe_propostas_insert_organization"
  ON public.pipe_propostas FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: Admins podem atualizar qualquer proposta da org. Usuários só as suas ou sem responsável.
CREATE POLICY "pipe_propostas_update_by_responsibility"
  ON public.pipe_propostas FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, closer_id, NULL)
      OR
      public.has_no_responsible(NULL, closer_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, closer_id, NULL)
      OR
      public.has_no_responsible(NULL, closer_id, NULL)
    )
  );

-- DELETE: Apenas admins podem deletar propostas
CREATE POLICY "pipe_propostas_delete_admin_only"
  ON public.pipe_propostas FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 6: ATUALIZAR POLÍTICAS RLS - PIPE_WHATSAPP
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Pipe whatsapp visível para autenticados" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "Team members podem gerenciar pipe whatsapp" ON public.pipe_whatsapp;

-- SELECT: Admins veem tudo, usuários veem apenas onde são sdr_id OU sem responsável
CREATE POLICY "pipe_whatsapp_select_by_responsibility"
  ON public.pipe_whatsapp FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, NULL, NULL)
      OR
      public.has_no_responsible(sdr_id, NULL, NULL)
    )
  );

-- INSERT: Qualquer usuário da organização pode criar whatsapp leads
CREATE POLICY "pipe_whatsapp_insert_organization"
  ON public.pipe_whatsapp FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: Admins podem atualizar qualquer whatsapp lead da org. Usuários só os seus ou sem responsável.
CREATE POLICY "pipe_whatsapp_update_by_responsibility"
  ON public.pipe_whatsapp FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, NULL, NULL)
      OR
      public.has_no_responsible(sdr_id, NULL, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, NULL, NULL)
      OR
      public.has_no_responsible(sdr_id, NULL, NULL)
    )
  );

-- DELETE: Apenas admins podem deletar whatsapp leads
CREATE POLICY "pipe_whatsapp_delete_admin_only"
  ON public.pipe_whatsapp FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 7: ATUALIZAR POLÍTICAS RLS - CAMPANHA_LEADS
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Leads visíveis para team members" ON public.campanha_leads;
DROP POLICY IF EXISTS "Team members podem gerenciar campanha leads" ON public.campanha_leads;

-- SELECT: Admins veem tudo, usuários veem apenas onde são sdr_id OU sem responsável
CREATE POLICY "campanha_leads_select_by_responsibility"
  ON public.campanha_leads FOR SELECT
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, NULL, NULL)
      OR
      public.has_no_responsible(sdr_id, NULL, NULL)
    )
  );

-- INSERT: Qualquer usuário da organização pode criar campanha leads
CREATE POLICY "campanha_leads_insert_organization"
  ON public.campanha_leads FOR INSERT
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- UPDATE: Admins podem atualizar qualquer campanha lead da org. Usuários só os seus ou sem responsável.
CREATE POLICY "campanha_leads_update_by_responsibility"
  ON public.campanha_leads FOR UPDATE
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, NULL, NULL)
      OR
      public.has_no_responsible(sdr_id, NULL, NULL)
    )
  )
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(sdr_id, NULL, NULL)
      OR
      public.has_no_responsible(sdr_id, NULL, NULL)
    )
  );

-- DELETE: Apenas admins podem deletar campanha leads
CREATE POLICY "campanha_leads_delete_admin_only"
  ON public.campanha_leads FOR DELETE
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- =====================================================
-- PARTE 8: ATUALIZAR POLÍTICAS RLS - CONVERSATIONS
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Users can view conversations from their organization" ON public.conversations;
DROP POLICY IF EXISTS "Service role can manage conversations" ON public.conversations;
DROP POLICY IF EXISTS "service_role_conversations_all" ON public.conversations;

-- SELECT: Admins veem tudo, usuários veem apenas onde são assigned_to OU sem responsável
CREATE POLICY "conversations_select_by_responsibility"
  ON public.conversations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, NULL, assigned_to)
      OR
      public.has_no_responsible(NULL, NULL, assigned_to)
    )
  );

-- INSERT: Admins e service role podem inserir conversas
CREATE POLICY "conversations_insert_admin_service"
  ON public.conversations FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR
    (
      public.is_user_admin()
      AND organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- UPDATE: Admins podem atualizar qualquer conversa da org. Usuários só as suas ou sem responsável.
CREATE POLICY "conversations_update_by_responsibility"
  ON public.conversations FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      auth.role() = 'service_role'
      OR
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, NULL, assigned_to)
      OR
      public.has_no_responsible(NULL, NULL, assigned_to)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      auth.role() = 'service_role'
      OR
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, NULL, assigned_to)
      OR
      public.has_no_responsible(NULL, NULL, assigned_to)
    )
  );

-- Service role mantém acesso total
CREATE POLICY "conversations_service_role_full_access"
  ON public.conversations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- PARTE 9: ATUALIZAR POLÍTICAS RLS - CONVERSATION_MESSAGES
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Users can view messages from conversations in their organization" ON public.conversation_messages;
DROP POLICY IF EXISTS "Service role can manage messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "service_role_conv_messages_all" ON public.conversation_messages;

-- SELECT: Baseado na conversa associada (seguir regras da conversation)
CREATE POLICY "conversation_messages_select_by_conversation"
  ON public.conversation_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(NULL, NULL, assigned_to)
        OR
        public.has_no_responsible(NULL, NULL, assigned_to)
      )
    )
  );

-- Service role mantém acesso total
CREATE POLICY "conversation_messages_service_role_full_access"
  ON public.conversation_messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- PARTE 10: ATUALIZAR POLÍTICAS RLS - WHATSAPP_MESSAGES
-- =====================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "Users can view messages from their organization" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Users can insert messages in their organization" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Users can update messages in their organization" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Service role full access" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Service role full access whatsapp messages" ON public.whatsapp_messages;

-- SELECT: Admins veem tudo, usuários veem apenas onde são assigned_to OU sem responsável
CREATE POLICY "whatsapp_messages_select_by_responsibility"
  ON public.whatsapp_messages FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, NULL, assigned_to)
      OR
      public.has_no_responsible(NULL, NULL, assigned_to)
    )
  );

-- INSERT: Admins e service role podem inserir mensagens
CREATE POLICY "whatsapp_messages_insert_admin_service"
  ON public.whatsapp_messages FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR
    (
      public.is_user_admin()
      AND organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- UPDATE: Admins podem atualizar qualquer mensagem da org. Usuários só as suas ou sem responsável.
CREATE POLICY "whatsapp_messages_update_by_responsibility"
  ON public.whatsapp_messages FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      auth.role() = 'service_role'
      OR
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, NULL, assigned_to)
      OR
      public.has_no_responsible(NULL, NULL, assigned_to)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      auth.role() = 'service_role'
      OR
      public.is_user_admin()
      OR
      public.is_user_responsible(NULL, NULL, assigned_to)
      OR
      public.has_no_responsible(NULL, NULL, assigned_to)
    )
  );

-- Service role mantém acesso total
CREATE POLICY "whatsapp_messages_service_role_full_access"
  ON public.whatsapp_messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- PARTE 11: ATUALIZAR POLÍTICAS RLS - TABELAS RELACIONADAS (via leads)
-- =====================================================

-- Lead History: seguir regras do lead associado
DROP POLICY IF EXISTS "Lead history visível para autenticados" ON public.lead_history;
DROP POLICY IF EXISTS "Team members podem gerenciar lead history" ON public.lead_history;
DROP POLICY IF EXISTS "lead_history_via_lead" ON public.lead_history;

CREATE POLICY "lead_history_select_by_lead"
  ON public.lead_history FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

CREATE POLICY "lead_history_insert_organization"
  ON public.lead_history FOR INSERT
  WITH CHECK (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "lead_history_update_by_lead"
  ON public.lead_history FOR UPDATE
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

CREATE POLICY "lead_history_delete_admin_only"
  ON public.lead_history FOR DELETE
  USING (
    public.is_user_admin()
    AND lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Lead Tags: seguir regras do lead associado
DROP POLICY IF EXISTS "Lead tags visíveis para autenticados" ON public.lead_tags;
DROP POLICY IF EXISTS "Team members podem gerenciar lead tags" ON public.lead_tags;
DROP POLICY IF EXISTS "lead_tags_via_lead" ON public.lead_tags;

CREATE POLICY "lead_tags_select_by_lead"
  ON public.lead_tags FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

CREATE POLICY "lead_tags_insert_organization"
  ON public.lead_tags FOR INSERT
  WITH CHECK (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "lead_tags_update_by_lead"
  ON public.lead_tags FOR UPDATE
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

CREATE POLICY "lead_tags_delete_by_lead"
  ON public.lead_tags FOR DELETE
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

-- Lead Custom Field Values: seguir regras do lead associado
DROP POLICY IF EXISTS "Users can view values for their org leads" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "Users can manage values for their org leads" ON public.lead_custom_field_values;

CREATE POLICY "lead_custom_field_values_select_by_lead"
  ON public.lead_custom_field_values FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

CREATE POLICY "lead_custom_field_values_insert_organization"
  ON public.lead_custom_field_values FOR INSERT
  WITH CHECK (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "lead_custom_field_values_update_by_lead"
  ON public.lead_custom_field_values FOR UPDATE
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

CREATE POLICY "lead_custom_field_values_delete_by_lead"
  ON public.lead_custom_field_values FOR DELETE
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR
        public.is_user_responsible(sdr_id, closer_id, NULL)
        OR
        public.has_no_responsible(sdr_id, closer_id, NULL)
      )
    )
  );

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON COLUMN public.conversations.assigned_to IS 'Usuário responsável por esta conversa. NULL = não atribuído (visível para todos). Admins veem todas as conversas.';
COMMENT ON COLUMN public.whatsapp_messages.assigned_to IS 'Usuário responsável por esta mensagem/conversa. NULL = não atribuído (visível para todos). Admins veem todas as mensagens.';
COMMENT ON FUNCTION public.is_user_responsible IS 'Verifica se o usuário atual é responsável por um item baseado em sdr_id, closer_id ou assigned_to';
COMMENT ON FUNCTION public.is_user_admin IS 'Verifica se o usuário atual é admin';
COMMENT ON FUNCTION public.has_no_responsible IS 'Verifica se um item não tem responsável atribuído (todos podem ver)';

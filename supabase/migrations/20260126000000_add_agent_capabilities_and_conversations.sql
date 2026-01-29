-- Migration: Add Agent Capabilities and Conversations System
-- Description: Adiciona capabilities à tabela copilot_agents e cria sistema de conversations
-- Date: 2026-01-26

-- =====================================================
-- PARTE 1: ADICIONAR CAPABILITIES À copilot_agents
-- =====================================================

-- Adicionar colunas de capabilities (feature flags) à tabela existente
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_qualify_lead BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_schedule_meeting BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_send_followup BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_update_crm BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_answer_faq BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_create_lead BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_transfer_human BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_conversation_turns INT DEFAULT 20,
  ADD COLUMN IF NOT EXISTS response_delay_ms INT DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS llm_model TEXT DEFAULT 'anthropic/claude-3.5-sonnet';

-- Adicionar constraint para garantir apenas um agente padrão por organização
CREATE UNIQUE INDEX IF NOT EXISTS idx_copilot_agents_org_default 
  ON public.copilot_agents(organization_id) 
  WHERE is_default = true;

-- =====================================================
-- PARTE 2: TABELAS DE CONVERSATIONS (State Machine)
-- =====================================================

-- Estado da conversa com cada lead
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,

  -- Estado da conversa
  state TEXT NOT NULL DEFAULT 'NEW_LEAD',
  -- Estados possíveis:
  -- 'NEW_LEAD' → primeiro contato
  -- 'QUALIFYING' → fazendo perguntas de qualificação
  -- 'QUALIFIED' → lead qualificado
  -- 'SCHEDULING' → agendando reunião
  -- 'SCHEDULED' → reunião agendada
  -- 'FOLLOW_UP' → em follow-up
  -- 'WAITING_HUMAN' → aguardando atendimento humano
  -- 'CLOSED_WON' → convertido
  -- 'CLOSED_LOST' → perdido

  turn_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),

  -- Contexto da conversa (armazena informações coletadas)
  context JSONB DEFAULT '{}',
  -- Exemplo: { "company_size": "50-100", "urgency": "high", "budget": "confirmed" }

  -- Memória de curto prazo (últimas 10 mensagens)
  short_term_memory JSONB DEFAULT '[]',

  -- Memória de longo prazo (fatos importantes)
  long_term_memory JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(lead_id)
);

-- Histórico de mensagens
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  metadata JSONB, -- { "action_taken": "SEND_WHATSAPP", "confidence": 0.95 }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Logs de decisões do agente (auditoria)
CREATE TABLE IF NOT EXISTS public.agent_decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Decisão tomada
  state_before TEXT NOT NULL,
  state_after TEXT NOT NULL,
  action_decided TEXT NOT NULL,
  reasoning TEXT, -- Por que o agente tomou essa decisão

  -- Prompt usado
  prompt_version TEXT,
  capabilities_snapshot JSONB,

  -- Resultado
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_conversations_org ON public.conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_state ON public.conversations(state, last_message_at);
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON public.conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv ON public.conversation_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_org ON public.agent_decision_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_conv ON public.agent_decision_logs(conversation_id);

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

-- Trigger para conversations
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Ativar RLS nas novas tabelas
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_decision_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- POLICIES PARA conversations
-- =====================================================

-- Usuários podem visualizar conversas da sua organização
CREATE POLICY "Users can view conversations from their organization"
  ON public.conversations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
  );

-- Service role pode gerenciar conversas (para Agent Engine)
CREATE POLICY "Service role can manage conversations"
  ON public.conversations FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- POLICIES PARA conversation_messages
-- =====================================================

-- Usuários podem visualizar mensagens de conversas da sua organização
CREATE POLICY "Users can view messages from conversations in their organization"
  ON public.conversation_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id
      FROM public.conversations
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Service role pode gerenciar mensagens (para Agent Engine)
CREATE POLICY "Service role can manage messages"
  ON public.conversation_messages FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- POLICIES PARA agent_decision_logs
-- =====================================================

-- Usuários podem visualizar logs de decisões da sua organização
CREATE POLICY "Users can view decision logs from their organization"
  ON public.agent_decision_logs FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
  );

-- Service role pode inserir logs (para Agent Engine)
CREATE POLICY "Service role can insert decision logs"
  ON public.agent_decision_logs FOR INSERT
  WITH CHECK (true);

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON TABLE public.conversations IS 'Estado da conversa com cada lead - State Machine para gerenciar fluxo de conversação';
COMMENT ON TABLE public.conversation_messages IS 'Histórico completo de mensagens trocadas entre lead e agente de IA';
COMMENT ON TABLE public.agent_decision_logs IS 'Logs de auditoria de todas as decisões tomadas pelo Agent Engine';

COMMENT ON COLUMN public.conversations.state IS 'Estado atual da conversa: NEW_LEAD, QUALIFYING, QUALIFIED, SCHEDULING, SCHEDULED, FOLLOW_UP, WAITING_HUMAN, CLOSED_WON, CLOSED_LOST';
COMMENT ON COLUMN public.conversations.context IS 'Contexto coletado durante a conversa (tamanho empresa, urgência, orçamento, etc.)';
COMMENT ON COLUMN public.conversations.short_term_memory IS 'Últimas mensagens da conversa (cache para performance)';
COMMENT ON COLUMN public.conversations.long_term_memory IS 'Fatos importantes extraídos da conversa (persistência)';

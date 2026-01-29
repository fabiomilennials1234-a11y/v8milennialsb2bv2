-- Migration: Follow-up Rules e Configurações Avançadas de Agentes
-- Description: Adiciona tabela de regras de follow-up e campos de contexto
-- Date: 2026-01-26

-- =====================================================
-- NOVA TABELA: FOLLOW-UP RULES
-- =====================================================

-- Tabela de regras de follow-up para agentes
CREATE TABLE public.copilot_agent_followup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  
  -- Identificação da regra
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0, -- Maior prioridade = executar primeiro
  
  -- GATILHOS DE TEMPO (quando disparar)
  trigger_type TEXT NOT NULL DEFAULT 'no_response', -- 'no_response', 'scheduled', 'event'
  trigger_delay_hours INTEGER DEFAULT 24, -- Horas sem resposta para disparar
  trigger_delay_minutes INTEGER DEFAULT 0, -- Minutos adicionais
  max_followups INTEGER DEFAULT 3, -- Máximo de follow-ups antes de parar
  
  -- FILTROS DE LEADS (com quem atuar)
  filter_tags TEXT[] DEFAULT '{}', -- Tags que o lead DEVE ter (AND)
  filter_tags_exclude TEXT[] DEFAULT '{}', -- Tags que o lead NÃO pode ter
  filter_origins TEXT[] DEFAULT '{}', -- Origens aceitas (vazio = todas)
  filter_pipes TEXT[] DEFAULT '{}', -- Pipelines onde atuar (vazio = todos)
  filter_stages TEXT[] DEFAULT '{}', -- Etapas específicas (vazio = todas)
  filter_custom_fields JSONB DEFAULT '{}', -- Filtros por campos personalizados
  -- Exemplo filter_custom_fields: {"faturamento": {"operator": ">", "value": "100000"}}
  
  -- COMPORTAMENTO DO FOLLOW-UP
  use_last_context BOOLEAN DEFAULT true, -- Usar contexto da última conversa
  context_lookback_days INTEGER DEFAULT 30, -- Quantos dias olhar para trás no histórico
  followup_style TEXT DEFAULT 'value', -- 'direct', 'value', 'curiosity', 'breakup'
  message_template TEXT, -- Template da mensagem (com variáveis)
  
  -- HORÁRIOS DE ENVIO
  send_only_business_hours BOOLEAN DEFAULT true,
  business_hours_start TIME DEFAULT '09:00',
  business_hours_end TIME DEFAULT '18:00',
  send_days TEXT[] DEFAULT ARRAY['seg', 'ter', 'qua', 'qui', 'sex'],
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  
  -- METADADOS
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- ADICIONAR CAMPOS À TABELA COPILOT_AGENTS
-- =====================================================

-- Adicionar coluna para prompts específicos por template
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS template_prompt_override TEXT;

-- Adicionar coluna para configuração de contexto
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS context_config JSONB DEFAULT '{
  "use_last_conversation": true,
  "max_history_messages": 10,
  "include_lead_data": true,
  "include_custom_fields": true,
  "summarize_long_conversations": true
}'::jsonb;

-- Adicionar coluna para anti-patterns
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS anti_patterns TEXT[] DEFAULT '{}';

-- Adicionar coluna para gatilhos de transferência
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS human_transfer_triggers TEXT[] DEFAULT '{}';

-- Adicionar coluna para detecção de intenção
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS intent_detection JSONB DEFAULT '{}'::jsonb;

-- =====================================================
-- NOVA TABELA: CONVERSATION CONTEXT (para follow-up)
-- =====================================================

-- Tabela para armazenar contexto resumido das conversas
CREATE TABLE IF NOT EXISTS public.conversation_context_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Resumo da conversa
  last_topic TEXT, -- Último assunto discutido
  last_intent TEXT, -- Última intenção detectada
  key_points TEXT[], -- Pontos-chave da conversa
  objections_raised TEXT[], -- Objeções levantadas
  questions_asked TEXT[], -- Perguntas feitas pelo lead
  next_action TEXT, -- Próxima ação sugerida
  
  -- Qualificação extraída
  qualification_data JSONB DEFAULT '{}', -- BANT extraído
  lead_temperature TEXT DEFAULT 'cold', -- 'cold', 'warm', 'hot'
  engagement_score INTEGER DEFAULT 0, -- 0-100
  
  -- Metadados
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  followup_count INTEGER DEFAULT 0,
  last_followup_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_context_per_lead UNIQUE (lead_id)
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================

CREATE INDEX idx_followup_rules_agent ON public.copilot_agent_followup_rules(agent_id);
CREATE INDEX idx_followup_rules_active ON public.copilot_agent_followup_rules(is_active, priority DESC);
CREATE INDEX idx_context_summary_lead ON public.conversation_context_summary(lead_id);
CREATE INDEX idx_context_summary_org ON public.conversation_context_summary(organization_id);
CREATE INDEX idx_context_summary_last_message ON public.conversation_context_summary(last_message_at);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger para followup_rules
CREATE TRIGGER update_copilot_agent_followup_rules_updated_at
  BEFORE UPDATE ON public.copilot_agent_followup_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para context_summary
CREATE TRIGGER update_conversation_context_summary_updated_at
  BEFORE UPDATE ON public.conversation_context_summary
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.copilot_agent_followup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_context_summary ENABLE ROW LEVEL SECURITY;

-- Policies para followup_rules (mesmo padrão de kanban_rules)
CREATE POLICY "Users can view followup rules from agents in their organization"
  ON public.copilot_agent_followup_rules FOR SELECT
  USING (
    agent_id IN (
      SELECT id
      FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Admins can manage followup rules"
  ON public.copilot_agent_followup_rules FOR ALL
  USING (
    agent_id IN (
      SELECT id
      FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Policies para context_summary
CREATE POLICY "Users can view context from their organization"
  ON public.conversation_context_summary FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "System can manage context"
  ON public.conversation_context_summary FOR ALL
  USING (true);

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON TABLE public.copilot_agent_followup_rules IS 'Regras de follow-up automático para agentes - define quando e como reengajar leads';
COMMENT ON TABLE public.conversation_context_summary IS 'Resumo do contexto de conversas para uso em follow-ups inteligentes';

COMMENT ON COLUMN public.copilot_agent_followup_rules.trigger_delay_hours IS 'Horas sem resposta para disparar o follow-up';
COMMENT ON COLUMN public.copilot_agent_followup_rules.filter_tags IS 'Tags que o lead DEVE ter para receber follow-up (lógica AND)';
COMMENT ON COLUMN public.copilot_agent_followup_rules.use_last_context IS 'Se true, usa o último assunto da conversa para personalizar mensagem';
COMMENT ON COLUMN public.copilot_agent_followup_rules.followup_style IS 'Estilo da mensagem: direct (direto), value (agregando valor), curiosity (gerando curiosidade), breakup (última tentativa)';

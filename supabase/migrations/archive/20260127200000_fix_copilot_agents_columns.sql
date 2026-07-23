-- Migration: Fix Copilot Agents Columns
-- Description: Garante que todas as colunas necessárias existam na tabela copilot_agents
-- Date: 2026-01-27

-- Verificar e adicionar colunas que podem estar faltando

-- Colunas do contexto do quiz (da migration 20260124213000)
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS business_context JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS conversation_style JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS qualification_rules JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS few_shot_examples JSONB DEFAULT '[]'::jsonb;

-- Colunas de disponibilidade (da migration 20260124220000)
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{"mode":"always","timezone":"America/Sao_Paulo","days":["mon","tue","wed","thu","fri"],"start":"09:00","end":"18:00"}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS response_delay_seconds INTEGER DEFAULT 0;

-- Colunas de BDR/Outbound (da migration 20260128100000)
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS operation_mode TEXT DEFAULT 'inbound';

-- Adicionar constraint apenas se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'copilot_agents' 
    AND constraint_name = 'copilot_agents_operation_mode_check'
  ) THEN
    ALTER TABLE public.copilot_agents 
    ADD CONSTRAINT copilot_agents_operation_mode_check 
    CHECK (operation_mode IN ('inbound', 'outbound', 'hybrid'));
  END IF;
END $$;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS activation_triggers JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS outbound_config JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS automation_actions JSONB DEFAULT NULL;

-- Verificar se a tabela campanhas existe antes de adicionar a constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campanhas') THEN
    ALTER TABLE public.copilot_agents 
    ADD COLUMN IF NOT EXISTS campaign_id UUID DEFAULT NULL;
    
    -- Adicionar constraint apenas se a tabela existir
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'copilot_agents_campaign_id_fkey'
    ) THEN
      ALTER TABLE public.copilot_agents 
      ADD CONSTRAINT copilot_agents_campaign_id_fkey 
      FOREIGN KEY (campaign_id) REFERENCES public.campanhas(id) ON DELETE SET NULL;
    END IF;
  ELSE
    -- Se a tabela não existir, adicionar apenas a coluna sem constraint
    ALTER TABLE public.copilot_agents 
    ADD COLUMN IF NOT EXISTS campaign_id UUID DEFAULT NULL;
  END IF;
END $$;

-- Comentários
COMMENT ON COLUMN public.copilot_agents.business_context IS 'Contexto do negócio coletado no quiz (produto, ICP, região, prova social, pricing, etc)';
COMMENT ON COLUMN public.copilot_agents.conversation_style IS 'Diretrizes de estilo e humanização para WhatsApp (ritmo, emojis, perguntas, etc)';
COMMENT ON COLUMN public.copilot_agents.qualification_rules IS 'Campos mínimos de qualificação e ordem sugerida';
COMMENT ON COLUMN public.copilot_agents.few_shot_examples IS 'Exemplos curtos de conversa (lead -> agente) para calibrar o tom';
COMMENT ON COLUMN public.copilot_agents.availability IS 'Regras de disponibilidade do agente: mode(always|scheduled), timezone, days, start, end';
COMMENT ON COLUMN public.copilot_agents.response_delay_seconds IS 'Atraso artificial de resposta (em segundos) para simular tempo humano';
COMMENT ON COLUMN public.copilot_agents.operation_mode IS 'Modo de operação: inbound (espera lead), outbound (inicia conversa), hybrid (ambos)';
COMMENT ON COLUMN public.copilot_agents.activation_triggers IS 'Condições para ativação do agente: tags, origens, campos personalizados';
COMMENT ON COLUMN public.copilot_agents.outbound_config IS 'Configuração de outbound: delay, template da primeira mensagem';
COMMENT ON COLUMN public.copilot_agents.automation_actions IS 'Ações automáticas: on_qualify, on_disqualify, on_need_human';
COMMENT ON COLUMN public.copilot_agents.campaign_id IS 'Campanha vinculada ao agente (opcional)';

-- Migration: Fix campanhas columns
-- Description: Adiciona colunas de modo de campanha que estão faltando
-- Date: 2026-01-31

-- ============================================
-- Adicionar colunas à tabela campanhas
-- ============================================

-- Coluna campaign_type
ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS campaign_type TEXT DEFAULT 'manual'
  CHECK (campaign_type IN ('automatica', 'semi_automatica', 'manual'));

COMMENT ON COLUMN public.campanhas.campaign_type IS 'Tipo: automatica (IA), semi_automatica (templates), manual (kanban)';

-- Coluna agent_id (referência ao agente copilot)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'campanhas' 
    AND column_name = 'agent_id'
  ) THEN
    -- Verificar se a tabela copilot_agents existe antes de criar a FK
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'copilot_agents') THEN
      ALTER TABLE public.campanhas 
      ADD COLUMN agent_id UUID REFERENCES public.copilot_agents(id) ON DELETE SET NULL;
    ELSE
      ALTER TABLE public.campanhas 
      ADD COLUMN agent_id UUID;
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN public.campanhas.agent_id IS 'Agente Copilot vinculado (apenas para campanhas automaticas)';

-- Coluna auto_config (configuração de automação)
ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS auto_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.campanhas.auto_config IS 'Config de automacao: delay_minutes, send_on_add_lead, working_hours_only, working_hours';

-- ============================================
-- Criar indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_campanhas_type ON public.campanhas(campaign_type);
CREATE INDEX IF NOT EXISTS idx_campanhas_agent ON public.campanhas(agent_id) WHERE agent_id IS NOT NULL;

-- ============================================
-- FIM DA MIGRATION
-- ============================================

-- Script de correção rápida para colunas do Copilot
-- Execute este script no SQL Editor do Supabase Dashboard
-- Data: 2026-01-27

-- Colunas do contexto do quiz
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS business_context JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS conversation_style JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS qualification_rules JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS few_shot_examples JSONB DEFAULT '[]'::jsonb;

-- Colunas de disponibilidade
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{"mode":"always","timezone":"America/Sao_Paulo","days":["mon","tue","wed","thu","fri"],"start":"09:00","end":"18:00"}'::jsonb;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS response_delay_seconds INTEGER DEFAULT 0;

-- Colunas de BDR/Outbound (ESTAS SÃO AS QUE ESTÃO FALTANDO!)
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS operation_mode TEXT DEFAULT 'inbound';

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS activation_triggers JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS outbound_config JSONB DEFAULT NULL;

ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS automation_actions JSONB DEFAULT NULL;

-- Verificar se a tabela campanhas existe antes de adicionar campaign_id
DO $$
BEGIN
  ALTER TABLE public.copilot_agents 
  ADD COLUMN IF NOT EXISTS campaign_id UUID DEFAULT NULL;
  
  -- Tentar adicionar constraint apenas se a tabela existir
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campanhas') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'copilot_agents_campaign_id_fkey'
      ) THEN
        ALTER TABLE public.copilot_agents 
        ADD CONSTRAINT copilot_agents_campaign_id_fkey 
        FOREIGN KEY (campaign_id) REFERENCES public.campanhas(id) ON DELETE SET NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Se der erro, apenas ignora (tabela pode não existir)
    RAISE NOTICE 'Constraint de campaign_id não pôde ser adicionada: %', SQLERRM;
  END;
END $$;

-- Verificar constraint de operation_mode
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint de operation_mode não pôde ser adicionada: %', SQLERRM;
END $$;

-- Verificar se as colunas foram criadas
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'copilot_agents'
  AND column_name IN (
    'activation_triggers',
    'outbound_config',
    'automation_actions',
    'operation_mode',
    'business_context',
    'conversation_style',
    'qualification_rules',
    'few_shot_examples',
    'availability',
    'response_delay_seconds'
  )
ORDER BY column_name;

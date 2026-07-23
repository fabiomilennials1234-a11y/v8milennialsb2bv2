-- Migration: Add AI Disabled flag to leads
-- Description: Permite desabilitar atendimento de IA para leads específicos
-- Date: 2026-01-27

-- Adicionar colunas para controle de IA no lead
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS ai_disabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_disabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Índice para buscar leads com IA desabilitada
CREATE INDEX IF NOT EXISTS idx_leads_ai_disabled 
  ON public.leads(ai_disabled) 
  WHERE ai_disabled = true;

-- Comentários para documentação
COMMENT ON COLUMN public.leads.ai_disabled IS 'Se true, o Copilot não responde mensagens deste lead';
COMMENT ON COLUMN public.leads.ai_disabled_at IS 'Data/hora em que a IA foi desabilitada para este lead';
COMMENT ON COLUMN public.leads.ai_disabled_by IS 'Usuário que desabilitou a IA para este lead';

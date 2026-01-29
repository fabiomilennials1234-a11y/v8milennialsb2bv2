-- Migration: Enhance Copilot Quiz Context
-- Description: Adds structured quiz fields to improve prompt quality and naturalness
-- Date: 2026-01-24

ALTER TABLE public.copilot_agents
ADD COLUMN IF NOT EXISTS business_context JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS conversation_style JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS qualification_rules JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS few_shot_examples JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.copilot_agents.business_context IS 'Contexto do negócio coletado no quiz (produto, ICP, região, prova social, pricing, etc)';
COMMENT ON COLUMN public.copilot_agents.conversation_style IS 'Diretrizes de estilo e humanização para WhatsApp (ritmo, emojis, perguntas, etc)';
COMMENT ON COLUMN public.copilot_agents.qualification_rules IS 'Campos mínimos de qualificação e ordem sugerida';
COMMENT ON COLUMN public.copilot_agents.few_shot_examples IS 'Exemplos curtos de conversa (lead -> agente) para calibrar o tom';

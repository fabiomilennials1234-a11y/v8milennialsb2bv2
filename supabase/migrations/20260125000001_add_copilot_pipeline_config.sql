-- ============================================
-- ADICIONAR CONFIGURAÇÕES DE PIPELINE AO COPILOT
-- ============================================
-- Adiciona campos para configurar em quais funis/etapas o agente está ativo
-- e se pode movimentar cards automaticamente

-- Adicionar colunas de configuração de pipeline
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS active_pipes JSONB DEFAULT '[]'::jsonb,
  -- Exemplo: ["confirmacao", "propostas", "whatsapp"]
  
  ADD COLUMN IF NOT EXISTS active_stages JSONB DEFAULT '{}'::jsonb,
  -- Exemplo: {
  --   "confirmacao": ["reuniao_marcada", "confirmar_d3", "confirmar_d1"],
  --   "propostas": ["marcar_compromisso", "compromisso_marcado"],
  --   "whatsapp": ["novo", "abordado"]
  -- }
  
  ADD COLUMN IF NOT EXISTS can_move_cards BOOLEAN DEFAULT false,
  -- Permite que o agente mova cards entre etapas/funis
  
  ADD COLUMN IF NOT EXISTS auto_move_on_qualify BOOLEAN DEFAULT false,
  -- Move automaticamente quando qualifica o lead
  
  ADD COLUMN IF NOT EXISTS auto_move_on_objective BOOLEAN DEFAULT false,
  -- Move automaticamente quando cumpre o objetivo
  
  ADD COLUMN IF NOT EXISTS move_rules JSONB DEFAULT '[]'::jsonb;
  -- Regras de movimentação: [
  --   {
  --     "from": { "pipe": "whatsapp", "stage": "novo" },
  --     "to": { "pipe": "confirmacao", "stage": "reuniao_marcada" },
  --     "condition": "qualified" // ou "objective_met"
  --   }
  -- ]

-- Comentários
COMMENT ON COLUMN public.copilot_agents.active_pipes IS 'Lista de funis onde o agente está ativo: ["confirmacao", "propostas", "whatsapp", "campanha"]';
COMMENT ON COLUMN public.copilot_agents.active_stages IS 'Etapas específicas de cada funil onde o agente está ativo (JSONB)';
COMMENT ON COLUMN public.copilot_agents.can_move_cards IS 'Se o agente pode movimentar cards entre etapas/funis';
COMMENT ON COLUMN public.copilot_agents.auto_move_on_qualify IS 'Move automaticamente quando qualifica o lead';
COMMENT ON COLUMN public.copilot_agents.auto_move_on_objective IS 'Move automaticamente quando cumpre o objetivo';
COMMENT ON COLUMN public.copilot_agents.move_rules IS 'Regras de movimentação automática (JSONB array)';

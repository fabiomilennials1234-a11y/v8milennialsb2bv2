-- ROLLBACK de 20270812110000_copilot_model_defaults_gpt41_mini.sql
--
-- Restaura os defaults de modelo anteriores à unificação em gpt-4.1-mini.
-- Só faz sentido junto do revert das edge functions do mesmo PR — reverter só
-- o schema devolve o descasamento que a migration existe para fechar.

ALTER TABLE public.copilot_conversation_evaluations
  ALTER COLUMN model_used SET DEFAULT 'google/gemini-2.0-flash-001'::text;

ALTER TABLE public.copilot_v2_agents
  ALTER COLUMN model_id SET DEFAULT 'google/gemini-2.5-flash'::public.copilot_v2_model_id;

COMMENT ON COLUMN public.copilot_conversation_evaluations.model_used IS NULL;

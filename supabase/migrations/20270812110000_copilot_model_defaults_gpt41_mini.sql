-- 20270812110000_copilot_model_defaults_gpt41_mini.sql
--
-- Motor único do Copilot: openai/gpt-4.1-mini (decisão CTO 2026-08-12).
--
-- O código das edge functions já foi trocado no mesmo PR, mas duas colunas
-- carregavam o modelo antigo no DEFAULT do schema — e default de coluna não é
-- alcançado por troca de código. Sem isto, a linha nasce mentindo.
--
--   1. copilot_conversation_evaluations.model_used
--      evaluate-agent-conversation NÃO grava esta coluna (conferido no código);
--      toda avaliação herda o default. Como a função agora roda gpt-4.1-mini, o
--      default 'google/gemini-2.0-flash-001' passaria a registrar um modelo que
--      não foi o usado — dado de auditoria falso.
--
--   2. copilot_v2_agents.model_id
--      Agente v2 novo nascia 'google/gemini-2.5-flash'. Hoje inócuo (o
--      model-selector escolhe por arquétipo e nada lê esta coluna), mas é dado
--      errado esperando alguém confiar nele.
--
-- Só schema — nenhum DML. As avaliações já gravadas REALMENTE rodaram em gemini;
-- reescrevê-las falsificaria o histórico. A única linha de copilot_v2_agents em
-- prod segue com o valor antigo, de propósito, pelo mesmo motivo (e porque
-- ninguém a lê). Ambos os valores continuam válidos no enum copilot_v2_model_id.

ALTER TABLE public.copilot_conversation_evaluations
  ALTER COLUMN model_used SET DEFAULT 'openai/gpt-4.1-mini'::text;

ALTER TABLE public.copilot_v2_agents
  ALTER COLUMN model_id SET DEFAULT 'openai/gpt-4.1-mini'::public.copilot_v2_model_id;

COMMENT ON COLUMN public.copilot_conversation_evaluations.model_used IS
  'Modelo que produziu a avaliação. Default acompanha o motor único do Copilot (openai/gpt-4.1-mini). Linhas anteriores a 2026-08-12 registram gemini e estão corretas.';

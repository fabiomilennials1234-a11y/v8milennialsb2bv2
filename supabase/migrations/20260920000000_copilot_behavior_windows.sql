-- Migration: Copilot Time-Aware Behavior — janelas customizáveis + enforcement
-- Description: Permite até 6 janelas de comportamento por agente (dias + horário + texto)
--              + toggle global hard/soft (canned vs LLM contextual fora horário).
-- Date: 2026-04-26
-- Retrocompat: backfill cria janela "Padrão" 7d/24h vazia para agentes existentes.
--              Agentes com behavior="" + enforcement="hard" mantêm comportamento atual via
--              checkOutOfHours legacy fallback (lê availability JSONB se windows vazio).

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS behavior_windows JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS behavior_enforcement TEXT DEFAULT 'hard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'copilot_agents'
      AND constraint_name = 'copilot_agents_behavior_enforcement_check'
  ) THEN
    ALTER TABLE public.copilot_agents
      ADD CONSTRAINT copilot_agents_behavior_enforcement_check
      CHECK (behavior_enforcement IN ('hard', 'soft'));
  END IF;
END$$;

COMMENT ON COLUMN public.copilot_agents.behavior_windows IS
  'Array de até 6 janelas de comportamento. Schema cada item: { id: uuid, name: text, days: text[] (mon|tue|wed|thu|fri|sat|sun), start: HH:MM, end: HH:MM, behavior: text (instrução textual injetada no prompt) }. Resolver pega primeira janela que casa (dia+hora) em ordem do array.';

COMMENT ON COLUMN public.copilot_agents.behavior_enforcement IS
  'hard: fora janela com behavior vazio devolve out_of_hours_message canned (não chama LLM). soft: sempre chama LLM injetando contexto temporal — nunca bloqueia resposta.';

-- Backfill: agentes existentes ganham 1 janela "Padrão" cobrindo 7d/24h sem instrução.
-- Combinado com enforcement='hard' (default) + checkOutOfHours legacy fallback,
-- comportamento permanece idêntico ao atual.
UPDATE public.copilot_agents
SET behavior_windows = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', 'Padrão',
    'days', jsonb_build_array('mon','tue','wed','thu','fri','sat','sun'),
    'start', '00:00',
    'end', '23:59',
    'behavior', ''
  )
)
WHERE behavior_windows = '[]'::jsonb OR behavior_windows IS NULL;

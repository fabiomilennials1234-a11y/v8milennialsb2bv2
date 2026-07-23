-- Onda 2 / T2.B.1 — Colunas de performance em runtime_logs
--
-- Habilita análise de latência + custo LLM por org/agent.
-- Patches em logger.ts (T2.B.2) populam essas colunas opcionalmente.

ALTER TABLE public.runtime_logs ADD COLUMN IF NOT EXISTS duration_ms int;
ALTER TABLE public.runtime_logs ADD COLUMN IF NOT EXISTS prompt_tokens int;
ALTER TABLE public.runtime_logs ADD COLUMN IF NOT EXISTS completion_tokens int;
ALTER TABLE public.runtime_logs ADD COLUMN IF NOT EXISTS llm_model text;

CREATE INDEX IF NOT EXISTS idx_runtime_logs_module_action_time
  ON public.runtime_logs (module, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_logs_perf
  ON public.runtime_logs (created_at DESC)
  WHERE duration_ms IS NOT NULL;

COMMENT ON COLUMN public.runtime_logs.duration_ms IS
  'Onda 2: latência da operação em ms. Populado por logRuntime quando aplicável.';
COMMENT ON COLUMN public.runtime_logs.prompt_tokens IS
  'Onda 2: tokens consumidos no prompt LLM (custo).';
COMMENT ON COLUMN public.runtime_logs.completion_tokens IS
  'Onda 2: tokens gerados pelo LLM (custo).';
COMMENT ON COLUMN public.runtime_logs.llm_model IS
  'Onda 2: model usado (ex: google/gemini-2.5-flash).';

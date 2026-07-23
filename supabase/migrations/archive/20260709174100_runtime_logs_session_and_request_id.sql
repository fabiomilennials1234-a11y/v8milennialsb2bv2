-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709174100  name: runtime_logs_session_and_request_id
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.runtime_logs
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS request_id UUID;

COMMENT ON COLUMN public.runtime_logs.session_id IS
  'Sessão de navegação do frontend (x-torque-session-id). Agrupa os logs de um Chamado.';
COMMENT ON COLUMN public.runtime_logs.request_id IS
  'Uma chamada HTTP (x-torque-request-id). Não confundir com o trace_id do Copilot v2.';

CREATE INDEX IF NOT EXISTS idx_runtime_logs_session_created
  ON public.runtime_logs (session_id, created_at)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runtime_logs_request
  ON public.runtime_logs (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.runtime_logs
  DROP CONSTRAINT IF EXISTS runtime_logs_module_check;

COMMENT ON COLUMN public.runtime_logs.module IS
  'Módulo emissor. Vocabulário garantido em compile time pelo union type RuntimeLogModule (_shared/logger.ts) — deliberadamente sem CHECK, ver migration 20270115.';

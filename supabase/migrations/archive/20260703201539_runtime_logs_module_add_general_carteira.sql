-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260703201539  name: runtime_logs_module_add_general_carteira
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- runtime_logs.module CHECK não incluía 'general'/'carteira' → logRuntime desses
-- módulos falhava silencioso (erp-order-webhook, tinyerp-sync-contacts). Amplia.
ALTER TABLE public.runtime_logs
  DROP CONSTRAINT IF EXISTS runtime_logs_module_check;
ALTER TABLE public.runtime_logs
  ADD CONSTRAINT runtime_logs_module_check
  CHECK (module = ANY (ARRAY[
    'pipe_dispatch','copilot','campaign','webhook','followup',
    'outbound','permission','workflow','general','carteira'
  ]));

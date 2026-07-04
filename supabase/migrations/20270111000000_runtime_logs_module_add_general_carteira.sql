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

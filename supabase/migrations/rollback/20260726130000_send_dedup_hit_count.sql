-- ROLLBACK de 20260726130000_send_dedup_hit_count.sql (#1156)
--
-- Aditiva → rollback = DROP coluna + restaura a CHECK sem copilot_v2.
-- ATENÇÃO: restaurar a CHECK estrita FALHA de propósito se já houver linha
-- source='copilot_v2' (reverter o schema com dado novo deixaria inconsistente).
-- Nesse caso, apague/rerotule as linhas copilot_v2 antes.
--
-- Rollback do CÓDIGO (send-dedup UPSERT / gate.ts dedup) = kill-switch OFF
-- (SEND_DEDUP_CONVERSATIONAL_ENABLED) ou redeploy anterior — sem tocar schema.

-- Dropar a RPC ANTES da coluna: o corpo referencia hit_count; mantê-la sem a
-- coluna deixaria a função quebrada em runtime.
DROP FUNCTION IF EXISTS public.fn_reserve_send(uuid, text, text, text, text, integer);

ALTER TABLE public.send_dedup_log
  DROP CONSTRAINT IF EXISTS send_dedup_log_source_check;
ALTER TABLE public.send_dedup_log
  ADD CONSTRAINT send_dedup_log_source_check
  CHECK (source IN ('manual','copilot','workflow','mass_send','followup'));

ALTER TABLE public.send_dedup_log DROP COLUMN IF EXISTS hit_count;

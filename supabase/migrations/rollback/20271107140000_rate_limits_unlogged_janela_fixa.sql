-- rollback/20271107140000_rate_limits_unlogged_janela_fixa.sql
--
-- Desfaz a M1. Rodar DEPOIS do rollback da M3 (o dispatcher chama
-- purge_rate_limits; sem a M3 revertida, a subtarefa `rate-limits-purge`
-- passa a falhar e abre alerta após 3 horas).
--
-- Corpo de check_rate_limit copiado de prod (pg_get_functiondef) em
-- 2026-10-05, antes do apply: janela deslizante para N ≠ 60, search_path
-- 'public'.
--
-- ⚠ O GRANT a authenticated NÃO volta por padrão: ele É o DoS cross-tenant
-- (qualquer logado pré-insere a chave de outra org com p_max_requests = 0).
-- Rollback de comportamento não reabre o furo. Se o CTO decidir reabrir,
-- descomente a linha marcada abaixo.
--
-- ⚠ Linhas purgadas não voltam (eram janelas encerradas, sem uso).
-- ⚠ SET LOGGED reescreve a tabela e gera WAL do conteúdo inteiro (pequeno
--   depois da purga). lock_timeout 3 s pelo mesmo motivo da ida.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.rate_limits SET LOGGED;

CREATE INDEX IF NOT EXISTS idx_rate_limits_key_window
  ON public.rate_limits USING btree (key, window_start DESC);

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_max_requests integer DEFAULT 100, p_window_seconds integer DEFAULT 60)
 RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_request_count INT;
  v_max_requests INT;
BEGIN
  -- Calculate window start: truncate to minute for 60s windows, sliding for custom
  IF p_window_seconds = 60 THEN
    v_window_start := date_trunc('minute', now());
  ELSE
    v_window_start := now() - (p_window_seconds || ' seconds')::interval;
  END IF;

  -- Upsert: insert new window or increment existing
  INSERT INTO rate_limits (key, window_start, window_seconds, request_count, max_requests)
  VALUES (p_key, v_window_start, p_window_seconds, 1, p_max_requests)
  ON CONFLICT (key, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING rate_limits.request_count, rate_limits.max_requests
  INTO v_request_count, v_max_requests;

  RETURN QUERY
    SELECT
      (v_request_count <= v_max_requests)::BOOLEAN AS allowed,
      GREATEST(v_max_requests - v_request_count, 0)::INT AS remaining,
      (v_window_start + (p_window_seconds || ' seconds')::interval) AS reset_at;
END;
$function$;

-- ACL de prod sem o furo: postgres + service_role.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
-- REABRIR O FURO (só com decisão explícita do CTO):
-- GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.purge_rate_limits();

COMMIT;

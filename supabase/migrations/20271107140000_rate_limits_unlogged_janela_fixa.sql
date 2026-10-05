-- 20271107140000_rate_limits_unlogged_janela_fixa.sql
--
-- ⚠️ VERSÃO PROVISÓRIA. O ledger de prod colide com frequência; renumerar
-- acima do topo real de supabase_migrations.schema_migrations na hora de
-- aplicar. Aplicação em prod é do CTO. Ordem: M1 (esta) → M2
-- (cron_gate_workflow_billing) → 24 h → M3 (cron_dispatch_minute).
-- Rollback pareado: supabase/migrations/rollback/<este arquivo>.
--
-- Contexto (OOM de prod em 2026-10-05): `check_rate_limit` roda ~5.540×/h no
-- pico (whatsapp-webhook por IP, notificame-webhook por org, lead-webhook por
-- IP, workflow-button-check). Cada chamada é um upsert em `rate_limits`, tabela
-- LOGGED: o WAL gerado é decodificado duas vezes pelos dois slots lógicos
-- (wal2json + pgoutput), embora a tabela esteja fora de qualquer publication.
-- A tabela tinha 213k linhas / 75 MB desde 15/05, sem purga, e um índice que
-- duplica a UNIQUE (key, window_start).
--
-- O que muda:
--   1. SEGURANÇA (bloqueante): EXECUTE de check_rate_limit sai de
--      authenticated/anon/PUBLIC. Antes, qualquer usuário logado pré-inseria
--      (chave-de-outra-org, minuto corrente) com p_max_requests = 0; o
--      ON CONFLICT não atualiza max_requests, então o webhook daquela org
--      recebia 429 o minuto inteiro — DoS cross-tenant. Todo chamador vivo é
--      edge function com service_role; o front não chama (só aparece em
--      types.ts).
--   2. Janela FIXA para p_window_seconds ≠ 60. Antes, a janela era
--      `now() - p_window_seconds` (deslizante): cada chamada caía numa
--      window_start nova, criava linha nova com request_count = 1 e o limite
--      NUNCA se aplicava (ex.: calculate-portfolio-health pede 1/dia). Agora a
--      janela é alinhada à época Unix: floor(epoch / N) * N. Para N = 86400 a
--      janela vira o dia UTC (00:00 UTC = 21:00 BRT).
--      Para N = 60 o ramo é o MESMO texto de antes, date_trunc('minute', now()):
--      a chave (key, window_start) de todo chamador vivo não muda nem por um
--      instante durante o deploy (provado em
--      tests/integration/cron-dispatch-minute.test.mjs contra o corpo de prod).
--      N nulo ou ≤ 0 agora é recusado (22023); antes N nulo violava NOT NULL e
--      N ≤ 0 produzia janela no futuro — nenhum chamador passa isso.
--   3. search_path '' com nomes qualificados (antes 'public').
--   4. purge_rate_limits(): apaga janela ENCERRADA há mais de 1 min
--      (window_start + window_seconds < now() - 1 min). Respeita a janela
--      diária: contador de 86400 aberto às 00:00 UTC sobrevive até 00:01 do
--      dia seguinte. Chamada de hora em hora pelo dispatcher da M3 (minuto 7).
--      Até a M3 entrar, nada purga — a tabela cresce sem WAL (~5k linhas/h).
--   5. Purga do acumulado → DROP do índice duplicado → SET UNLOGGED.
--      UNLOGGED: zero WAL, fora da decodificação lógica. Custo aceito: crash do
--      Postgres TRUNCA a tabela (todos os contadores zeram — no máximo uma
--      janela corrente de folga para cada chave). Nenhuma chave protege contra
--      ban do WhatsApp (saída = enforceWhatsAppRateLimit,
--      _shared/action-handlers/whatsapp-helpers.ts); todas são anti-flood de
--      ENTRADA, e 0 janelas passaram do teto nas 24 h medidas.
--      A purga é um DELETE só: dentro da transação da migration, lotes não
--      soltam lock nem WAL antes do COMMIT — o que reduz o lock exclusivo é
--      purgar ANTES do SET UNLOGGED, para a reescrita copiar poucas linhas.
--      lock_timeout 3 s: se o ACCESS EXCLUSIVE não vier rápido, a migration
--      falha inteira em vez de enfileirar os webhooks atrás dela.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_max_requests integer DEFAULT 100,
  p_window_seconds integer DEFAULT 60
)
 RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_window_start  timestamptz;
  v_request_count integer;
  v_max_requests  integer;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'check_rate_limit: p_window_seconds deve ser > 0 (recebido %)', p_window_seconds
      USING ERRCODE = '22023';
  END IF;

  -- 60 s: expressão idêntica à anterior — a chave de janela dos chamadores
  -- vivos não muda. Demais: janela fixa alinhada à época Unix (UTC).
  IF p_window_seconds = 60 THEN
    v_window_start := date_trunc('minute', now());
  ELSE
    v_window_start := to_timestamp(
      floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
    );
  END IF;

  INSERT INTO public.rate_limits AS rl (key, window_start, window_seconds, request_count, max_requests)
  VALUES (p_key, v_window_start, p_window_seconds, 1, p_max_requests)
  ON CONFLICT (key, window_start)
  DO UPDATE SET request_count = rl.request_count + 1
  RETURNING rl.request_count, rl.max_requests
  INTO v_request_count, v_max_requests;

  RETURN QUERY
    SELECT
      (v_request_count <= v_max_requests)::boolean AS allowed,
      GREATEST(v_max_requests - v_request_count, 0)::integer AS remaining,
      (v_window_start + make_interval(secs => p_window_seconds)) AS reset_at;
END;
$function$;

-- Supabase concede EXECUTE nominal a anon/authenticated/service_role em função
-- nova do schema public; REVOKE FROM PUBLIC sozinho não alcança o nominal.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_rate_limits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- Só janela ENCERRADA (com 1 min de folga para upsert em voo na virada).
  DELETE FROM public.rate_limits
   WHERE window_start + make_interval(secs => window_seconds) < now() - interval '1 minute';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_rate_limits() TO service_role;

SELECT public.purge_rate_limits();

DROP INDEX IF EXISTS public.idx_rate_limits_key_window;

ALTER TABLE public.rate_limits SET UNLOGGED;

COMMIT;

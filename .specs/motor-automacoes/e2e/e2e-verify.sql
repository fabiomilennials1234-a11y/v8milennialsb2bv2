DO $v$
DECLARE
  n_total int; n_claimed int; n_sem_lag int;
  atrasada_first timestamptz; recente_first timestamptz;
  lag_atrasada int; lag_recente int; n_cfg int;
BEGIN
  SELECT count(*), count(claimed_at), count(*) FILTER (WHERE claimed_at IS NOT NULL AND claimed_lag_ms IS NULL)
    INTO n_total, n_claimed, n_sem_lag FROM public.workflow_executions;

  IF n_claimed = 0 THEN RAISE EXCEPTION 'FALHOU: worker nao reivindicou nada (% no total)', n_total; END IF;
  IF n_sem_lag > 0 THEN RAISE EXCEPTION 'FALHOU: % reivindicadas sem claimed_lag_ms', n_sem_lag; END IF;

  -- Ordenacao por VENCIMENTO: a coorte atrasada tem que ser pega antes
  SELECT min(claimed_at) INTO atrasada_first FROM public.workflow_executions
   WHERE context->>'coorte'='atrasada' AND claimed_at IS NOT NULL;
  SELECT min(claimed_at) INTO recente_first FROM public.workflow_executions
   WHERE context->>'coorte'='recente' AND claimed_at IS NOT NULL;

  IF atrasada_first IS NULL THEN RAISE EXCEPTION 'FALHOU: nenhuma da coorte atrasada foi pega'; END IF;
  IF recente_first IS NOT NULL AND atrasada_first > recente_first THEN
    RAISE EXCEPTION 'FALHOU: coorte RECENTE foi pega antes da ATRASADA — ordenacao por nascimento viva';
  END IF;

  -- Lag congelado no claim bate com o vencimento sintetico
  SELECT round(avg(claimed_lag_ms)) INTO lag_atrasada FROM public.workflow_executions
   WHERE context->>'coorte'='atrasada' AND claimed_lag_ms IS NOT NULL;
  SELECT round(avg(claimed_lag_ms)) INTO lag_recente FROM public.workflow_executions
   WHERE context->>'coorte'='recente' AND claimed_lag_ms IS NOT NULL;

  IF lag_atrasada < 500000 THEN RAISE EXCEPTION 'FALHOU: lag da atrasada=%ms, esperado ~600000', lag_atrasada; END IF;
  IF lag_recente IS NOT NULL AND lag_recente >= lag_atrasada THEN
    RAISE EXCEPTION 'FALHOU: lag recente(%) >= atrasada(%) — medicao invertida', lag_recente, lag_atrasada;
  END IF;

  -- Controlador rodou e persistiu estado
  SELECT count(*) INTO n_cfg FROM public.cron_config
   WHERE key IN ('workflow_pool_sat_streak','workflow_pool_idle_streak');
  IF n_cfg <> 2 THEN RAISE EXCEPTION 'FALHOU: controlador nao persistiu contadores'; END IF;

  RAISE NOTICE 'PASSOU E2E: %/% reivindicadas, lag atrasada=%ms recente=%ms',
    n_claimed, n_total, lag_atrasada, lag_recente;
END $v$;

SELECT context->>'coorte' AS coorte, count(*) AS n,
       count(claimed_at) AS reivindicadas,
       round(avg(claimed_lag_ms)) AS lag_medio_ms,
       count(*) FILTER (WHERE status='completed') AS completadas
FROM public.workflow_executions GROUP BY 1 ORDER BY 1;

SELECT key, value FROM public.cron_config WHERE key LIKE 'workflow_pool%' ORDER BY key;

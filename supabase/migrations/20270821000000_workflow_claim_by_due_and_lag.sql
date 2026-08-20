-- =====================================================
-- Motor de automações — claim por vencimento + medição de Lag
--
-- Ver ADR-0023 e .specs/motor-automacoes/PLANO-A-B.md
--
-- Três mudanças:
--   1. Ordenar a fila por VENCIMENTO (next_run_at), não por NASCIMENTO (started_at).
--      Medido em prod: 36,1h de distância média entre os dois (máx 720h). Uma execução
--      que dormiu 7 dias num nó de delay passava na frente de lead que esperava 3 min.
--      Alinha com o índice que já existe: idx_workflow_executions_claim (status, next_run_at).
--   2. Gravar Lag no momento do claim. NÃO dá para derivar depois: o executor reescreve
--      next_run_at ao agendar o próximo passo, o que tornaria claimed_at - next_run_at
--      NEGATIVO. Por isso o valor é congelado em claimed_lag_ms na hora.
--   3. per_org_cap deixa de ser o freio (5 -> 1000). O freio passa a ser orçamento de
--      wall-clock + concorrência limitada, no worker.
--
-- CREATE OR REPLACE (não DROP+CREATE): preserva os GRANTs de EXECUTE.
-- =====================================================

-- ── 1. Colunas de medição ───────────────────────────────────────────────────
ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS claimed_lag_ms INTEGER;

COMMENT ON COLUMN public.workflow_executions.claimed_at IS
  'Quando um worker reivindicou esta execução pela última vez. Ver CONTEXT.md: Claim.';

COMMENT ON COLUMN public.workflow_executions.claimed_lag_ms IS
  'Lag do último claim, em ms: claim - vencimento. Congelado no claim porque next_run_at '
  'é reescrito depois pelo executor. Ver CONTEXT.md: Lag (distinto de Wait).';

-- ── 2. Claim por vencimento ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_workflow_executions(
  batch_size int DEFAULT 20,
  per_org_cap int DEFAULT 1000
)
RETURNS SETOF public.workflow_executions
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  WITH eligible AS (
    SELECT id, organization_id,
           -- Due: next_run_at quando existe; senão a execução venceu ao nascer.
           ROW_NUMBER() OVER (
             PARTITION BY organization_id
             ORDER BY COALESCE(next_run_at, started_at) ASC
           ) AS rn_org
    FROM public.workflow_executions
    WHERE
      (status = 'running' AND (next_run_at IS NULL OR next_run_at <= NOW()))
      OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
      OR (status = 'waiting_response' AND next_run_at IS NOT NULL AND next_run_at <= NOW())
  ),
  capped AS (
    SELECT id FROM eligible WHERE rn_org <= per_org_cap
  ),
  picked AS (
    SELECT we.id
    FROM public.workflow_executions we
    WHERE we.id IN (SELECT id FROM capped)
    ORDER BY COALESCE(we.next_run_at, we.started_at) ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.workflow_executions w
  SET
    status = 'processing',
    updated_at = NOW(),
    claimed_at = NOW(),
    claimed_lag_ms = GREATEST(
      0,
      (EXTRACT(EPOCH FROM (NOW() - COALESCE(w.next_run_at, w.started_at))) * 1000)::bigint
    )::int,
    context = CASE
      WHEN w.status = 'waiting_response' AND w.next_run_at <= NOW()
        THEN COALESCE(w.context, '{}'::jsonb) || '{"_wait_resolved":"timeout"}'::jsonb
      ELSE w.context
    END
  WHERE w.id IN (SELECT id FROM picked)
    AND (
      (w.status = 'running' AND (w.next_run_at IS NULL OR w.next_run_at <= NOW()))
      OR (w.status = 'processing' AND w.updated_at < NOW() - INTERVAL '10 minutes')
      OR (w.status = 'waiting_response' AND w.next_run_at IS NOT NULL AND w.next_run_at <= NOW())
    )
  RETURNING w.*;
$function$;

COMMENT ON FUNCTION public.claim_workflow_executions(int, int) IS
  'Reivindica execuções vencidas por ordem de VENCIMENTO (não de nascimento) e congela o Lag. '
  'per_org_cap DEFAULT 1000 = praticamente sem teto por contagem: o freio real é o orçamento de '
  'wall-clock + concorrência do worker. Ver ADR-0023.';

-- ── 3. Parâmetros do worker e do controlador ────────────────────────────────
INSERT INTO public.cron_config (key, value) VALUES
  ('workflow_pool_mode',        'auto'),
  ('workflow_pool_size',        '4'),
  ('workflow_pool_min',         '4'),
  ('workflow_pool_max',         '16'),
  ('workflow_run_budget_ms',    '45000'),
  ('workflow_pool_last_change', '1970-01-01T00:00:00.000Z'),
  ('workflow_pool_sat_streak',  '0'),
  ('workflow_pool_idle_streak', '0')
ON CONFLICT (key) DO NOTHING;

-- ── 4. Leitura do Lag pelo Master ───────────────────────────────────────────
-- SECURITY DEFINER com o gate DENTRO: RLS na tabela não fecha uma DEFINER.
-- Sem parâmetro de org — devolve todas, e quem não é master não passa do RAISE.

CREATE OR REPLACE FUNCTION public.master_workflow_lag_by_org(p_days int DEFAULT 7)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  claims bigint,
  lag_p50_ms int,
  lag_p90_ms int,
  lag_max_ms int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF NOT (SELECT public.is_master_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT e.organization_id,
         o.name::text,
         count(*)::bigint,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e.claimed_lag_ms)::int,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY e.claimed_lag_ms)::int,
         max(e.claimed_lag_ms)::int
  FROM public.workflow_executions e
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.claimed_at > NOW() - make_interval(days => GREATEST(1, LEAST(90, p_days)))
    AND e.claimed_lag_ms IS NOT NULL
  GROUP BY e.organization_id, o.name
  ORDER BY 5 DESC NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.master_workflow_lag_by_workflow(p_days int DEFAULT 7, p_limit int DEFAULT 10)
RETURNS TABLE (
  workflow_id uuid,
  workflow_name text,
  organization_name text,
  claims bigint,
  lag_p90_ms int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF NOT (SELECT public.is_master_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT e.workflow_id,
         w.name::text,
         o.name::text,
         count(*)::bigint,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY e.claimed_lag_ms)::int
  FROM public.workflow_executions e
  JOIN public.workflows w ON w.id = e.workflow_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.claimed_at > NOW() - make_interval(days => GREATEST(1, LEAST(90, p_days)))
    AND e.claimed_lag_ms IS NOT NULL
  GROUP BY e.workflow_id, w.name, o.name
  ORDER BY 5 DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(50, p_limit));
END $$;

-- Estado do motor. Devolve APENAS as chaves workflow_pool* — cron_config guarda
-- o cron_secret e ele não pode chegar ao browser de ninguém.
CREATE OR REPLACE FUNCTION public.master_workflow_pool_state()
RETURNS TABLE (key text, value text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF NOT (SELECT public.is_master_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.key::text, c.value::text
  FROM public.cron_config c
  WHERE c.key LIKE 'workflow_pool%' OR c.key = 'workflow_run_budget_ms';
END $$;

-- Grants explícitos: CREATE OR REPLACE preserva, mas função nova nasce com
-- EXECUTE para PUBLIC. Revoga e concede só a authenticated.
REVOKE ALL ON FUNCTION public.master_workflow_lag_by_org(int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.master_workflow_lag_by_workflow(int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.master_workflow_pool_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_workflow_lag_by_org(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_workflow_lag_by_workflow(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_workflow_pool_state() TO authenticated;

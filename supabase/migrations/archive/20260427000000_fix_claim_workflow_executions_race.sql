-- =====================================================
-- Fix: claim_workflow_executions race under concurrent invocations
-- =====================================================
--
-- Bug confirmado em prod (2026-04-27, lead Viviane Sevla,
-- execution f3018fae-926d-446a-a752-e09a27f9cbd8):
--
-- Duas invocações de process-workflow-executions chegaram com 3ms de
-- diferença e ambas receberam a MESMA workflow_executions row do RPC.
-- Resultado: nodes audio → move_stage → wait_response executados duas
-- vezes, dois áudios PTT enviados ao lead.
--
-- A versão anterior do RPC tinha FOR UPDATE SKIP LOCKED no CTE `picked`,
-- mas o UPDATE final usava apenas `WHERE id IN (SELECT id FROM picked)`,
-- sem revalidar o predicado de elegibilidade. Em READ COMMITTED, com
-- duas transações concorrentes, é possível T2 entrar no UPDATE com um
-- snapshot que ainda enxerga a row como elegível mesmo após T1 ter
-- comitado status='processing', porque a revalidação SKIP LOCKED ocorre
-- só na subquery — e o predicado completo não é re-aplicado no UPDATE.
--
-- Fix: replicar o predicado de elegibilidade no WHERE do UPDATE. Combinado
-- com FOR UPDATE SKIP LOCKED na subquery, fecha a race definitivamente.
-- Apenas uma transação consegue atualizar status='processing' por row.
--
-- Não altera assinatura, comportamento esperado, parâmetros ou consumidores.
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_workflow_executions(
  batch_size integer DEFAULT 20,
  per_org_cap integer DEFAULT 5
)
RETURNS SETOF public.workflow_executions
LANGUAGE sql
AS $$
  WITH eligible AS (
    SELECT id, organization_id, started_at,
           ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY started_at ASC) AS rn_org
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
    ORDER BY we.started_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.workflow_executions w
  SET
    status = 'processing',
    updated_at = NOW(),
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
$$;

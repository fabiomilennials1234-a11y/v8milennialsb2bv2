-- Onda 1 / P2 cleanup — Drop RPCs legacy mantidas como overload
--
-- Migration 20260426000004 criou novas assinaturas com per_org_cap mas
-- Postgres mantém versões antigas como overload separado. Callers (cron jobs,
-- edge functions) podem ainda bater nas antigas. Removemos pra forçar uso da
-- nova versão (defaults garantem compat retroativa: per_org_cap tem DEFAULT).

DROP FUNCTION IF EXISTS public.claim_workflow_executions(integer);
DROP FUNCTION IF EXISTS public.claim_pending_ai_actions(integer);
DROP FUNCTION IF EXISTS public.fire_workflow_trigger(uuid, text, uuid, jsonb);

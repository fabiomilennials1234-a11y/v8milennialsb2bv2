-- get_operations_overview · conta pela AMOSTRAGEM do logger (Fase 1)
--
-- TIMESTAMP PROVISÓRIO: renumerar contra o ledger de prod na hora de aplicar.
-- Transacional: pode ir por apply_migration. APLICAR JUNTO COM O DEGRAU 1 do
-- logger (whatsapp-webhook): antes dele não existe linha com `_sample_rate` e
-- a função nova devolve exatamente o que a antiga devolvia (peso 1 em tudo).
--
-- POR QUE: o logger (`_shared/logger.ts`, SUCCESS_SAMPLE_RATE) grava só uma
-- fração do sucesso de alto volume e marca a linha com
-- `payload_snapshot._sample_rate`. Contar linhas derrubaria `jobs_success` e
-- `jobs_total` em ~70% (115k sucessos/24 h, ~83k amostrados) no KPI da tela
-- master (`MasterOperations.tsx:127`). Cada linha passa a pesar
-- 1/_sample_rate (sem a marca: 1) — o estimador de Horvitz-Thompson da
-- amostragem de Bernoulli; arredondado para inteiro.
--
-- `jobs_error`: erro nunca é amostrado — continua COUNT puro.
-- `orgs_active`: continua COUNT(DISTINCT). É APROXIMADO para org cuja ÚNICA
--   atividade na janela tenha sido sucesso amostrado — ela some da contagem se
--   nenhuma linha dela for sorteada. Risco baixo: as orgs ativas produzem
--   centenas de eventos/dia, P(nenhuma sorteada a 1%) ≈ 0,99^N.
--
-- `_sample_rate` só é lido quando é número JSON (`jsonb_typeof = 'number'`):
-- payload escrito à mão com string não derruba a função com erro de cast.
--
-- Corpo de PROD (pg_get_functiondef, 2026-10-05) preservado: LANGUAGE sql,
-- SECURITY DEFINER, SET search_path TO 'public', gate `is_master_user()`.
-- CREATE OR REPLACE (nunca DROP+CREATE) mantém dono e ACL de prod:
--   {postgres=X, anon=X, authenticated=X, service_role=X} — o gate é o
--   is_master_user() dentro do corpo. Nenhum GRANT/REVOKE aqui.
--
-- REVERSÃO EXATA:
--   CREATE OR REPLACE FUNCTION public.get_operations_overview(interval_param text DEFAULT '24 hours'::text)
--    RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--     SELECT CASE WHEN public.is_master_user() THEN (
--       SELECT json_build_object(
--         'jobs_success', COUNT(*) FILTER (WHERE status = 'success'),
--         'jobs_error',   COUNT(*) FILTER (WHERE status = 'error'),
--         'jobs_total',   COUNT(*),
--         'orgs_active',  COUNT(DISTINCT organization_id)
--       ) FROM public.runtime_logs WHERE created_at > NOW() - interval_param::INTERVAL
--     ) ELSE json_build_object('error','access_denied') END;
--   $function$;

BEGIN;

CREATE OR REPLACE FUNCTION public.get_operations_overview(interval_param text DEFAULT '24 hours'::text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.is_master_user() THEN (
    SELECT json_build_object(
      'jobs_success', ROUND(COALESCE(SUM(w.peso) FILTER (WHERE w.status = 'success'), 0))::bigint,
      'jobs_error',   COUNT(*) FILTER (WHERE w.status = 'error'),
      'jobs_total',   ROUND(COALESCE(SUM(w.peso), 0))::bigint,
      'orgs_active',  COUNT(DISTINCT w.organization_id)
    )
    FROM (
      SELECT r.status,
             r.organization_id,
             COALESCE(
               CASE WHEN jsonb_typeof(r.payload_snapshot -> '_sample_rate') = 'number'
                    THEN 1 / NULLIF((r.payload_snapshot ->> '_sample_rate')::numeric, 0)
               END,
               1
             ) AS peso
        FROM public.runtime_logs r
       WHERE r.created_at > NOW() - interval_param::INTERVAL
    ) w
  ) ELSE json_build_object('error','access_denied') END;
$function$;

COMMIT;

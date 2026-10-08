-- agent_decision_logs · 1C — consolidar a purga num job só (73 → 106)
--
-- TIMESTAMP PROVISÓRIO: renumerar contra o ledger de prod na hora de aplicar.
-- Transacional: pode ir por apply_migration.
--
-- Em prod (2026-10-05) DOIS jobs apagam agent_decision_logs > 30 dias:
--   73  agent-decision-logs-retention  '23 3 * * *'
--       DELETE ... created_at < now()-30d;
--       UPDATE ... SET capabilities_snapshot = NULL
--         WHERE capabilities_snapshot IS NOT NULL AND created_at < now()-1d;
--   106 purge-copilot-midia-logs       '8-59/15 * * * *'
--       SELECT public.purge_copilot_e_midia_logs()  (mesmo DELETE, em lote)
-- E o 73 dispara às 03:23, o mesmo minuto do 106 (:08/:23/:38/:53).
--
-- O que o 73 faz e o 106 não: o UPDATE que esvazia `capabilities_snapshot`
-- (~96 KB/linha) depois de 1 dia. Ele entra na função ANTES de o 73 sair —
-- mesma transação, então não existe janela sem o UPDATE.
--
-- Corpo de PROD (pg_get_functiondef, 2026-10-05) preservado; a função não
-- existe em nenhuma migration do repositório (só em prod). Duas mudanças:
--   1. + UPDATE de capabilities_snapshot (vindo do job 73);
--   2. search_path 'public' → '' (DEFINER; todo nome já é qualificado).
-- CREATE OR REPLACE preserva dono e ACL de prod ({postgres, service_role});
-- o REVOKE/GRANT abaixo só reproduz essa ACL em ambiente onde a função nasce.
--
-- O 73 é DESATIVADO por jobname (não removido): reversão é um alter_job.
--
-- REVERSÃO EXATA:
--   SELECT cron.alter_job(job_id := jobid, active := true)
--     FROM cron.job WHERE jobname = 'agent-decision-logs-retention';
--   CREATE OR REPLACE FUNCTION public.purge_copilot_e_midia_logs()
--    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   begin
--     delete from public.agent_decision_logs
--     where ctid in (
--       select ctid from public.agent_decision_logs
--       where created_at < now() - interval '30 days'
--       limit 50000
--     );
--     delete from public.media_purge_queue
--     where ctid in (
--       select ctid from public.media_purge_queue
--       where purged_at is not null
--         and purged_at < now() - interval '7 days'
--       limit 50000
--     );
--   end;
--   $function$;

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_copilot_e_midia_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
begin
  delete from public.agent_decision_logs
  where ctid in (
    select ctid from public.agent_decision_logs
    where created_at < now() - interval '30 days'
    limit 50000
  );

  -- Vindo do job 73 (agent-decision-logs-retention): o snapshot de
  -- capabilities pesa ~96 KB por linha e só serve no dia da decisão.
  update public.agent_decision_logs
     set capabilities_snapshot = null
   where capabilities_snapshot is not null
     and created_at < now() - interval '1 day';

  delete from public.media_purge_queue
  where ctid in (
    select ctid from public.media_purge_queue
    where purged_at is not null
      and purged_at < now() - interval '7 days'
    limit 50000
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.purge_copilot_e_midia_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_copilot_e_midia_logs() TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — desativação de agent-decision-logs-retention ignorada';
    RETURN;
  END IF;
  PERFORM cron.alter_job(job_id := j.jobid, active := false)
     FROM cron.job j
    WHERE j.jobname = 'agent-decision-logs-retention';
END $$;

COMMIT;

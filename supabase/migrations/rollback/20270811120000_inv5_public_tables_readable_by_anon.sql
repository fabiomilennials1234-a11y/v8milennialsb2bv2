-- Rollback de 20270811120000_inv5_public_tables_readable_by_anon.sql
--
-- Só remove detecção. Nenhum dado é tocado no apply, então nada há para
-- restaurar aqui — e nenhuma tabela volta a ficar exposta por causa deste
-- rollback, porque a migration nunca revogou nem concedeu nada em tabela.
--
-- As linhas já escritas em `runtime_logs` ficam: são a trilha de quando o
-- banco esteve exposto, e apagá-las destruiria a auditoria justamente do que o
-- invariante existe para registrar.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inv5-public-tables-readable-by-anon') THEN
    PERFORM cron.unschedule('inv5-public-tables-readable-by-anon');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.inv_scan_public_tables_readable_by_anon();
DROP FUNCTION IF EXISTS public.inv_public_tables_readable_by_anon();

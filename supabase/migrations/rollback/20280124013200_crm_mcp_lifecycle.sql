-- Rollback de 20280124013200_crm_mcp_lifecycle.sql.
-- Rode ANTES do rollback de 20280124013100 (a faxina e o gatilho tocam a tabela de tokens).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('crm-mcp-housekeeping')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-mcp-housekeeping');
  END IF;
END $$;

DROP TRIGGER IF EXISTS zz_crm_mcp_revoke_on_deactivate ON public.team_members;
DROP TRIGGER IF EXISTS zz_crm_mcp_revoke_on_delete ON public.team_members;
DROP FUNCTION IF EXISTS public.crm_mcp_revoke_on_offboarding();
DROP FUNCTION IF EXISTS public.crm_mcp_housekeeping();

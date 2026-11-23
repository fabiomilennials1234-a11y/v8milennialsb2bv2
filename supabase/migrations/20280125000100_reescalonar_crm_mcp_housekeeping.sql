-- A limpeza das 06:17 UTC coincidia com purgas recorrentes. 06:11 mantém a
-- frequência diária e respeita o teto de conexões do escalonamento de crons.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  -- O pg_cron atualiza o job nomeado do mesmo usuário. Só move o que ainda
  -- tem a configuração original, preservando jobs desativados ou alterados.
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'crm-mcp-housekeeping'
      AND username = current_user
      AND database = current_database()
      AND active
      AND schedule = '17 6 * * *'
      AND command = 'SELECT public.crm_mcp_housekeeping();'
  ) THEN
    PERFORM cron.schedule('crm-mcp-housekeeping', '11 6 * * *', 'SELECT public.crm_mcp_housekeeping();');
  END IF;
END $$;

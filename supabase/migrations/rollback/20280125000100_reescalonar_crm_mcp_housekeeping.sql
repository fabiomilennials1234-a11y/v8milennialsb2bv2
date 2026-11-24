DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'crm-mcp-housekeeping'
      AND username = current_user
      AND database = current_database()
      AND active
      AND schedule = '11 6 * * *'
      AND command = 'SELECT public.crm_mcp_housekeeping();'
  ) THEN
    PERFORM cron.schedule('crm-mcp-housekeeping', '17 6 * * *', 'SELECT public.crm_mcp_housekeeping();');
  END IF;
END $$;

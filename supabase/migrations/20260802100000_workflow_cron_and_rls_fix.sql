-- Fix: apply the cron jobs and RLS policies that failed in 20260802000000
-- due to nested $$ delimiter issue (now using $outer$/$cron$ delimiters)

-- 1. pg_cron: process-workflow-executions every 1 minute
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old job if exists
    PERFORM cron.unschedule('process-workflow-executions')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'process-workflow-executions'
    );

    -- Schedule new job
    PERFORM cron.schedule(
      'process-workflow-executions',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/process-workflow-executions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $outer$;

-- 2. pg_cron: workflow cron triggers (checks cron-type workflows every minute)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('workflow-cron-triggers')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'workflow-cron-triggers'
    );

    PERFORM cron.schedule(
      'workflow-cron-triggers',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/process-workflow-executions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret')
        ),
        body := '{"mode":"cron_triggers"}'::jsonb
      );
      $cron$
    );
  END IF;
END $outer$;

-- 3. RLS policy for service_role on workflow_executions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_executions'
      AND policyname = 'workflow_executions_service_role'
  ) THEN
    CREATE POLICY "workflow_executions_service_role" ON public.workflow_executions
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. RLS policy for service_role on workflow_execution_steps
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_execution_steps'
      AND policyname = 'workflow_execution_steps_service_role'
  ) THEN
    CREATE POLICY "workflow_execution_steps_service_role" ON public.workflow_execution_steps
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

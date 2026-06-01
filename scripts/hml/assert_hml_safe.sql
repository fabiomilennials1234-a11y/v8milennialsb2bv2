-- assert_hml_safe.sql — Fail-closed guard for the HML refresh pipeline.
--
-- Verifies the post-neutralize state and ABORTS (RAISE EXCEPTION) if any
-- outbound vector is still live. Run as the LAST step of refresh-hml.sh; a
-- non-zero exit must keep HML locked instead of releasing it.
--
-- Pure SQL (no psql meta-commands) so it runs both via psql and the pg driver.
-- When run with psql, invoke with `-v ON_ERROR_STOP=1` so a RAISE yields a
-- non-zero process exit.

DO $$
DECLARE n int;
BEGIN
  -- Scheduler: every pg_cron job must be inactive (tolerant if pg_cron absent).
  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT count(*) INTO n FROM cron.job WHERE active;
    IF n <> 0 THEN RAISE EXCEPTION 'HML UNSAFE: % active cron job(s)', n; END IF;
  END IF;

  -- Credentials: WhatsApp instance secrets must be wiped.
  SELECT count(*) INTO n FROM public.whatsapp_instance_secrets;
  IF n <> 0 THEN RAISE EXCEPTION 'HML UNSAFE: % whatsapp_instance_secrets row(s)', n; END IF;

  -- Config: no prod worker URL may remain in cron_config.
  SELECT count(*) INTO n FROM public.cron_config WHERE value LIKE '%jsjsmuncfkbsbzqzqhfq%';
  IF n <> 0 THEN RAISE EXCEPTION 'HML UNSAFE: % cron_config row(s) still point at prod', n; END IF;

  RAISE NOTICE 'HML SAFE: all checked outbound vectors severed';
END $$;

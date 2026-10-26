-- Operational provisioning, run after the two schema migrations and Edge deploy.
-- Only the Vault name is stored in cron.job. Never substitute a secret into this file.
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'meta_crm_cron_secret') THEN
    RAISE EXCEPTION 'Meta CRM cron credential missing from Vault';
  END IF;
END
$check$;
SELECT cron.schedule(
  'meta-crm-webhook-drain', '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/meta-webhook',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_crm_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);
SELECT cron.schedule(
  'meta-crm-retention', '17 3 * * *',
  $job$
  DELETE FROM public.meta_oauth_nonces WHERE expires_at < now() - interval '24 hours';
  DELETE FROM public.meta_webhook_receipts WHERE status = 'completed' AND completed_at < now() - interval '7 days';
  $job$
);

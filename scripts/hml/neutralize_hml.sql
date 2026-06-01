-- neutralize_hml.sql — Make a prod-restored database safe for HML (homologation).
--
-- Severs every outbound vector so the homologation environment can NEVER reach
-- real customers. Idempotent and tolerant of an absent pg_cron. Run AFTER a prod
-- restore and BEFORE releasing HML for use (see PRD #612 / slice #613).
--
-- Layers (blanket-first):
--   1. Scheduler   — disable every pg_cron job (no per-name list: robust to new jobs)
--   2. Credentials — wipe WhatsApp instance secrets (no token => cannot auth to uazapi)
--   3. Config      — rewrite prod worker URLs in cron_config (jsjsm -> bcfad)
--   4. Actors      — pause copilot agents, campaigns, workflows
--   5. Queues      — drain outbound / job queues

-- Layer 1 — scheduler. Blanket-disable; tolerant if pg_cron is not installed.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    UPDATE cron.job SET active = false WHERE active;
  END IF;
END $$;

-- Layer 2 — WhatsApp credentials.
DELETE FROM public.whatsapp_instance_secrets;

-- Layer 3 — cron_config: a prod worker URL must never point HML at prod functions.
UPDATE public.cron_config
   SET value = replace(value, 'jsjsmuncfkbsbzqzqhfq', 'bcfadphgsibjzivtbjvc')
 WHERE value LIKE '%jsjsmuncfkbsbzqzqhfq%';

-- Layer 4 — app actors: pause all automation that could message real leads.
UPDATE public.copilot_agents SET is_active = false WHERE is_active IS DISTINCT FROM false;
UPDATE public.campanhas      SET is_active = false WHERE is_active IS DISTINCT FROM false;
UPDATE public.workflows      SET is_active = false WHERE is_active IS DISTINCT FROM false;

-- Layer 5 — drain outbound / job queues captured in the prod snapshot.
DELETE FROM public.uazapi_sender_jobs;
DELETE FROM public.history_sync_jobs;
DELETE FROM public.webhook_deliveries;

-- ============================================================================
-- runtime_logs: allow module = 'whatsapp'
-- ============================================================================
-- Root cause (incident 2026-06-24): runtime_logs_module_check listed only 8
-- modules and 'whatsapp' was ABSENT. Every logRuntime({ module: 'whatsapp' })
-- emitted by whatsapp-health-monitor, whatsapp-rebind-webhook and
-- whatsapp-session-watchdog was rejected by Postgres and silently swallowed by
-- logger.ts's catch — 0 rows module='whatsapp' in 10 days vs 904k module='webhook'.
-- This blinded us to the WhatsApp inbound outage (Bertin): ~40 "successful"
-- rebinds/day were logged nowhere and never proven to actually apply.
--
-- The new value set is a strict SUPERSET of the previous one, so every existing
-- row already satisfies it and VALIDATE is trivial. We still use
-- NOT VALID + VALIDATE so the validation scan takes SHARE UPDATE EXCLUSIVE
-- instead of holding ACCESS EXCLUSIVE on this large, high-write table.

ALTER TABLE public.runtime_logs
  DROP CONSTRAINT IF EXISTS runtime_logs_module_check;

ALTER TABLE public.runtime_logs
  ADD CONSTRAINT runtime_logs_module_check
  CHECK (module IN (
    'pipe_dispatch', 'copilot', 'campaign', 'webhook',
    'followup', 'outbound', 'permission', 'workflow',
    'whatsapp'
  )) NOT VALID;

ALTER TABLE public.runtime_logs
  VALIDATE CONSTRAINT runtime_logs_module_check;

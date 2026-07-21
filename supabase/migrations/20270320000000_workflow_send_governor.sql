-- ============================================================================
-- WhatsApp anti-ban Send Governor (Onda 1) — org config columns
-- ============================================================================
-- ADDITIVE, non-destructive. Adds the two columns the workflow Send Governor
-- reads to decide whether an automation-driven WhatsApp send may go now, must be
-- jittered, or must be deferred (per-number cap / org cap / quiet hours).
--
-- Design (see supabase/functions/_shared/action-handlers/send-governor.ts):
--   * workflow_send_governor_enabled — MASTER kill-switch, per org. Default FALSE:
--     with it off the governor is a PERFECT NO-OP (byte-identical to the legacy
--     fixed 3s throttle). Enabling is an explicit, per-org opt-in.
--   * workflow_send_governor — optional JSONB tuning. NULL = code defaults. Each
--     lever carries its own mode ('off' | 'shadow' | 'enforce') so a lever can be
--     observed (shadow) before it enforces. Shape:
--       {
--         "jitter":       { "mode": "enforce", "min_ms": 3000, "max_ms": 8000 },
--         "instance_cap": { "mode": "enforce" },
--         "org_cap":      { "mode": "enforce" },
--         "quiet_hours":  { "mode": "enforce", "days": [1,2,3,4,5,6],
--                           "from_minutes": 480, "to_minutes": 1200,
--                           "morning_spread_max_min": 90,
--                           "timezone": "America/Sao_Paulo" },
--         "max_defers": 5
--       }
--
-- No new functions, no RLS change: organizations already enforces tenant
-- isolation, and only the service_role edge function reads/writes these fields.
-- The daily-volume ledgers (blast_instance_daily_usage / blast_daily_usage) and
-- their SECURITY DEFINER increment RPCs are REUSED as-is — the governor shares the
-- same budget line as Mass Send on purpose (there is no per-origin column).
--
-- APLICAR em DEV (bcfadphgsibjzivtbjvc). Prod só com aval explícito do CTO.
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS workflow_send_governor_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_send_governor jsonb;

COMMENT ON COLUMN public.organizations.workflow_send_governor_enabled IS
  'Master kill-switch for the workflow WhatsApp Send Governor (anti-ban Onda 1). '
  'FALSE (default) = perfect no-op: automation sends keep the legacy fixed 3s '
  'throttle, no cap, no quiet-hours, no defer. TRUE = the governor evaluates each '
  'lever per workflow_send_governor. Per-org opt-in.';

COMMENT ON COLUMN public.organizations.workflow_send_governor IS
  'Optional JSONB tuning for the Send Governor. NULL = code defaults. Per-lever '
  'mode off|shadow|enforce (jitter, instance_cap, org_cap, quiet_hours) + '
  'max_defers. See _shared/action-handlers/send-governor.ts. Governor ON with an '
  'unset lever defaults that lever to enforce (protections ON, opt-out via JSONB).';

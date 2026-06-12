-- Fix FK constraints that block master deletion of organizations (round 2).
--
-- Root cause: same class as 20260929000000 — tables added since that patch
-- reference organizations (directly or via an org-scoped parent) WITHOUT
-- ON DELETE CASCADE, so `DELETE FROM organizations` aborts with a FK violation.
--
-- Only constraints that genuinely block are touched here. NO ACTION is checked
-- at statement-end, so children that are themselves removed by their own
-- organization_id CASCADE in the same statement are deferred-safe and are left
-- as-is (custom_pipe_entries.stage_id, goals.product_id,
-- scheduled_user_messages.created_by, workflow_executions.retry_of).
--
-- Blockers fixed:
--   1. client_health_snapshots.organization_id  NO ACTION — own org ref, no cascade path
--   2. retention_suggestions.organization_id    NO ACTION — own org ref, no cascade path
--   3. upsell_clients.lead_id                    RESTRICT  — immediate check (not deferrable)
--   4. google_calendar_sync_logs.agent_id        NO ACTION — no org column; only dies via agent
--
-- Verified against prod (jsjsmuncfkbsbzqzqhfq) 2026-06-11: test orgs held 283
-- client_health_snapshots, 1 retention_suggestions, 12 upsell_clients rows.

BEGIN;

-- 1. client_health_snapshots.organization_id — NO ACTION -> CASCADE
ALTER TABLE public.client_health_snapshots
  DROP CONSTRAINT IF EXISTS client_health_snapshots_organization_id_fkey,
  ADD CONSTRAINT client_health_snapshots_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

-- 2. retention_suggestions.organization_id — NO ACTION -> CASCADE
ALTER TABLE public.retention_suggestions
  DROP CONSTRAINT IF EXISTS retention_suggestions_organization_id_fkey,
  ADD CONSTRAINT retention_suggestions_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

-- 3. upsell_clients.lead_id — RESTRICT -> CASCADE
--    (an upsell client is meaningless without its lead; upsell_clients already
--     cascades via organization_id, this just removes the immediate RESTRICT)
ALTER TABLE public.upsell_clients
  DROP CONSTRAINT IF EXISTS upsell_clients_lead_id_fkey,
  ADD CONSTRAINT upsell_clients_lead_id_fkey
    FOREIGN KEY (lead_id)
    REFERENCES public.leads(id)
    ON DELETE CASCADE;

-- 4. google_calendar_sync_logs.agent_id — NO ACTION -> CASCADE
--    (sync logs belong to an agent and have no organization_id of their own;
--     CASCADE is their only cleanup path when the agent/org is deleted)
ALTER TABLE public.google_calendar_sync_logs
  DROP CONSTRAINT IF EXISTS google_calendar_sync_logs_agent_id_fkey,
  ADD CONSTRAINT google_calendar_sync_logs_agent_id_fkey
    FOREIGN KEY (agent_id)
    REFERENCES public.copilot_agents(id)
    ON DELETE CASCADE;

COMMIT;

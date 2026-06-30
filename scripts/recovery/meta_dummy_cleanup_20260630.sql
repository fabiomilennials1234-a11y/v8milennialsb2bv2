-- =============================================================================
-- Meta Lead Ads "Testing Tool" dummy-lead cleanup — 2026-06-30
-- =============================================================================
-- Context: lead-webhook detects dummy test leads (email=test@meta.com,
-- name/phone="<test lead: dummy data for X>") only to SKIP DEDUP, but still
-- INSERTS them. Every Meta integration test since 2026-03 created junk leads.
-- Older ones land in the deactivated "novo" stage -> invisible in kanban but
-- still counted = "leads fantasmas" (reported by HGE Iluminação).
--
-- This soft-deletes the still-active dummies across ALL orgs (authorized: CTO,
-- escopo "Tudo"). Matches app semantics (bulk_delete_leads RPC / _softdel.sql):
-- set deleted_at + clear pipeline_entries so the kanban is clean.
--
-- Predicate is junk-specific (no real lead has email=test@meta.com nor a name
-- starting with "<test lead: dummy data"). Defense-in-depth: only leads with
-- zero conversations and zero whatsapp_messages are touched. Idempotent.
-- Reversible: restore_lead / restore_leads_bulk (deleted_at -> NULL).
-- Target DB: prod jsjsmuncfkbsbzqzqhfq.
-- =============================================================================
WITH target AS (
  SELECT l.id
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND (l.email = 'test@meta.com' OR l.name ILIKE '<test lead: dummy data%')
    AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.lead_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.lead_id = l.id)
),
del_pe AS (
  DELETE FROM public.pipeline_entries
  WHERE lead_id IN (SELECT id FROM target)
  RETURNING 1
),
upd AS (
  UPDATE public.leads
  SET deleted_at = now(), deleted_by = NULL
  WHERE id IN (SELECT id FROM target) AND deleted_at IS NULL
  RETURNING 1
)
SELECT (SELECT count(*) FROM upd)    AS leads_soft_deleted,
       (SELECT count(*) FROM del_pe) AS pipeline_entries_removed;

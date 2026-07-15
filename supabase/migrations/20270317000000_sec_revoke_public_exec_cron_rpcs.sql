-- Security hardening — Audit 2026-07-14, Onda 1 / Fatia 1.
-- Revoke PUBLIC/anon/authenticated EXECUTE on 7 SECURITY DEFINER cron/service_role
-- helper RPCs. Verified: these are invoked ONLY by edge functions / pg_cron via
-- service_role (process-followup-situations, meta-conversion-dispatch,
-- copilot-batch-processor, agent-message). No frontend caller. Left anon-callable they
-- are an unauthenticated / cross-tenant surface via /rest/v1/rpc/<fn>:
--   * caller-supplied p_organization_id => read any org's pipeline (audit #3)
--       get_whatsapp_situation_candidates, get_meeting_reminder_candidates,
--       get_proposal_no_reply_candidates, get_dormant_winback_candidates
--   * unauthenticated all-org contact PII export (audit #7)
--       get_pending_meta_conversion_signals
--   * unauthenticated WRITE to the sale_events revenue ledger + full-scan DoS (audit #9)
--       fn_backfill_state_sales
--   * unauthenticated WRITE / DoS on the copilot message queue (audit #10)
--       claim_copilot_batch
-- service_role keeps its explicit EXECUTE grant (present in every proacl) so cron/edge
-- paths are unaffected. Reversible: GRANT EXECUTE ... TO PUBLIC restores prior state.
-- Idempotent (REVOKE/GRANT re-apply as no-ops).

REVOKE EXECUTE ON FUNCTION public.get_whatsapp_situation_candidates(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_meeting_reminder_candidates(uuid, text[])   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_proposal_no_reply_candidates(uuid, text[])  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_dormant_winback_candidates(uuid, text[])    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_meta_conversion_signals()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_backfill_state_sales()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_copilot_batch(text)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_copilot_batch(text, integer)              FROM PUBLIC, anon, authenticated;

-- Guarantee the service_role path survives (defensive; already granted).
GRANT EXECUTE ON FUNCTION public.get_whatsapp_situation_candidates(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_meeting_reminder_candidates(uuid, text[])   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_proposal_no_reply_candidates(uuid, text[])  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dormant_winback_candidates(uuid, text[])    TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_meta_conversion_signals()           TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_backfill_state_sales()                       TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_copilot_batch(text)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_copilot_batch(text, integer)              TO service_role;

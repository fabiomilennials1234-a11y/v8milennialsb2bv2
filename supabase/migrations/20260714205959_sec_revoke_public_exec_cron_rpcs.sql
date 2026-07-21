-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260714205959  name: sec_revoke_public_exec_cron_rpcs
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Security hardening — Audit 2026-07-14, Onda 1 / Fatia 1.
-- Revoke PUBLIC/anon/authenticated EXECUTE on 7 SECURITY DEFINER cron/service_role RPCs.
-- Verified: invoked ONLY by edge/pg_cron via service_role; no frontend caller.
-- service_role keeps its explicit grant. Reversible. Idempotent.

REVOKE EXECUTE ON FUNCTION public.get_whatsapp_situation_candidates(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_meeting_reminder_candidates(uuid, text[])   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_proposal_no_reply_candidates(uuid, text[])  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_dormant_winback_candidates(uuid, text[])    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_meta_conversion_signals()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_backfill_state_sales()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_copilot_batch(text)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_copilot_batch(text, integer)              FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_situation_candidates(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_meeting_reminder_candidates(uuid, text[])   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_proposal_no_reply_candidates(uuid, text[])  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dormant_winback_candidates(uuid, text[])    TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_meta_conversion_signals()           TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_backfill_state_sales()                       TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_copilot_batch(text)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_copilot_batch(text, integer)              TO service_role;

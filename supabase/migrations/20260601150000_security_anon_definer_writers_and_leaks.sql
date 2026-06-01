-- 20260601150000_security_anon_definer_writers_and_leaks.sql
--
-- Incident 2026-06-01 (part 3 — final audit sweep). Applied to PROD live via
-- `supabase db query --linked`; durable record (also apply to DEV). Idempotent.
--
-- Final audit found a class of anon-executable SECURITY DEFINER functions keyed on
-- lead_id/phone/conversation_id/doc_id (NOT org_id, so missed by part 2). An
-- unauthenticated attacker could mutate cross-org via e.g. transfer_lead_to_human
-- (disable AI + hijack conversation), increment (generic counter bump on any row),
-- save_document_content (poison agent RAG), claim_*_batch (disrupt dispatch).
-- Also: orphan backup table readable cross-org by authenticated; secret tables
-- still carried an anon grant (RLS blocked, but should be deny-all).

-- (1) Revoke anon/PUBLIC EXECUTE on every anon-executable DEFINER writer.
--     Keep authenticated (UI) + service_role (cron/edge). Trigger functions are
--     unaffected (they fire as definer regardless of EXECUTE grant). Writer
--     functions are never RLS-policy predicates, so RLS evaluation is unaffected.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND pg_get_functiondef(p.oid) ~* '(INSERT INTO|UPDATE |DELETE FROM)'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- (2) transfer_lead_to_human: fully unguarded (no auth, no org-scope) and only
--     called by an edge function (service_role) -> lock to service_role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='transfer_lead_to_human'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- (3) Orphan backup table (RLS disabled + authenticated SELECT grant -> any logged-in
--     user read 4188 lead/pipe rows cross-org). Cut access; data preserved (reversible).
--     DROP it once confirmed unneeded.
REVOKE ALL ON public.pipeline_entries_revert_20260514 FROM anon, authenticated;

-- (4) Secret/credential tables: make anon deny-all (RLS already blocked anon, but the
--     grant was unnecessary attack surface — mirror whatsapp_instance_secrets).
REVOKE ALL ON public.api_keys             FROM anon;
REVOKE ALL ON public.email_accounts       FROM anon;
REVOKE ALL ON public.google_calendar_tokens FROM anon;
REVOKE ALL ON public.meta_connections     FROM anon;
REVOKE ALL ON public.tinyerp_connections  FROM anon;
REVOKE ALL ON public.whatsapp_rate_tracking FROM anon;

-- NOTE (follow-ups, not done here):
--  * Storage bucket `media` is public — fine for avatars/help, but ensure WhatsApp
--    conversation media is NOT written there (use a private bucket + signed URLs).
--  * ~60 SECURITY DEFINER functions lack `SET search_path` — add `SET search_path = public, pg_temp`.
--  * Verify org-scoped RLS on api_keys/email_accounts/*_tokens for authenticated cross-org.
--  * Add a pgTAP CI guard: fail if any org-scoped table has a {public}/USING(true) policy,
--    or if any DEFINER writer is anon-executable.

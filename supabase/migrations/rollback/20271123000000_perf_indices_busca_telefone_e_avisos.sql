-- Rollback of 20271123000000_perf_indices_busca_telefone_e_avisos.sql.
-- Only drops the two indexes this migration created. pg_trgm stays: the
-- baseline owns it and `idx_leads_org_name_trgm` / `idx_companies_name_trgm`
-- depend on it. No data, policy or function is touched.
BEGIN;

DROP INDEX IF EXISTS public.lead_phones_normalized_phone_trgm_idx;
DROP INDEX IF EXISTS public.notifications_recipient_org_recent_idx;

COMMIT;

-- Restore pre-migration schema. Org settings are restored by the separate
-- activation rollback, preserving any unrelated feature flags/settings.
DROP TRIGGER IF EXISTS zz_guard_strict_lead_assignment ON public.leads;
DROP TRIGGER IF EXISTS zz_guard_strict_pipeline_assignment ON public.pipeline_entries;
DROP TRIGGER IF EXISTS zz_guard_strict_lead_owners ON public.lead_owners;
DROP POLICY IF EXISTS strict_owner_leads_select ON public.leads;
DROP POLICY IF EXISTS strict_owner_leads_update ON public.leads;
DROP POLICY IF EXISTS strict_owner_leads_delete ON public.leads;
DROP POLICY IF EXISTS strict_owner_pipeline_entries ON public.pipeline_entries;
DROP FUNCTION IF EXISTS private.guard_strict_lead_assignment();
DROP FUNCTION IF EXISTS private.strict_lead_owner_allowed(uuid,uuid,text);
DROP FUNCTION IF EXISTS private.strict_lead_is_owned(uuid, uuid);
DROP FUNCTION IF EXISTS private.strict_lead_member_orgs();

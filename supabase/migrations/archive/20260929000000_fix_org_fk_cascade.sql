-- Fix FK constraints missing ON DELETE CASCADE for organizations
-- Root cause: master panel cannot delete orgs because these FKs block cascade

BEGIN;

-- 1. tags.organization_id — NOT NULL, no CASCADE
ALTER TABLE public.tags
  DROP CONSTRAINT IF EXISTS tags_organization_id_fkey,
  ADD CONSTRAINT tags_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

-- 2. awards.organization_id — nullable, no CASCADE
ALTER TABLE public.awards
  DROP CONSTRAINT IF EXISTS awards_organization_id_fkey,
  ADD CONSTRAINT awards_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

-- 3. google_calendar_tokens.organization_id — nullable, no CASCADE
ALTER TABLE public.google_calendar_tokens
  DROP CONSTRAINT IF EXISTS google_calendar_tokens_organization_id_fkey,
  ADD CONSTRAINT google_calendar_tokens_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

-- 4. _lead_duplicates_audit.organization_id — nullable, no CASCADE
ALTER TABLE public._lead_duplicates_audit
  DROP CONSTRAINT IF EXISTS _lead_duplicates_audit_organization_id_fkey,
  ADD CONSTRAINT _lead_duplicates_audit_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

-- 5. impersonation_sessions.target_organization_id — nullable, no CASCADE
ALTER TABLE public.impersonation_sessions
  DROP CONSTRAINT IF EXISTS impersonation_sessions_target_organization_id_fkey,
  ADD CONSTRAINT impersonation_sessions_target_organization_id_fkey
    FOREIGN KEY (target_organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

COMMIT;

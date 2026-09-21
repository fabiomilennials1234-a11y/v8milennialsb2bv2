-- Preserve origin identities already referenced by workflow definitions.
DROP TRIGGER IF EXISTS seed_lead_origins_after_org_insert ON public.organizations;
DROP FUNCTION IF EXISTS public.seed_lead_origins_on_org_create();
DROP FUNCTION IF EXISTS public.seed_organization_lead_origins(uuid);

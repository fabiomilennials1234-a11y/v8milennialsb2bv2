-- rollback/20270302000000_org_timezone_and_metric_period_bounds.sql
--
-- Reverses 20270302000000 (issue #989): removes metric_period_bounds, the
-- timezone validation trigger + helpers, and organizations.timezone.
--
-- WARNING: dropping the column discards any per-org timezone already set
-- (orgs revert to implicit America/Sao_Paulo behavior in legacy RPCs). Run
-- only if no metric RPC references metric_period_bounds yet.

DROP FUNCTION IF EXISTS public.metric_period_bounds(uuid, text, date, date, date);

DROP TRIGGER IF EXISTS organizations_validate_timezone ON public.organizations;
DROP FUNCTION IF EXISTS public.validate_organization_timezone();
DROP FUNCTION IF EXISTS public.is_valid_timezone(text);

ALTER TABLE public.organizations DROP COLUMN IF EXISTS timezone;

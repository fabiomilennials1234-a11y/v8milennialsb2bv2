-- Operator-only repair: only organizations with an entirely missing catalogue.
-- Preview with ROLLBACK first. Existing catalogues, UUIDs, inactive records and
-- customized labels are not touched. No workflows or lead records are modified.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT o.id AS organization_id, public.seed_organization_lead_origins(o.id) AS inserted
FROM public.organizations o
WHERE NOT EXISTS(SELECT 1 FROM public.lead_origins x WHERE x.organization_id=o.id)
ORDER BY o.id;
SELECT count(*) AS missing_catalogues FROM public.organizations o
WHERE NOT EXISTS(SELECT 1 FROM public.lead_origins x WHERE x.organization_id=o.id);
COMMIT;

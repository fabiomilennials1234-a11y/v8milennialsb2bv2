-- Synthetic fixture BEFORE 20270925000000's mandatory non-empty backup checks.
-- Installed only by prepare-historical-fixtures.mjs in unlinked GitHub Actions.
-- Never place this file in the repository's production migration directory.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
INSERT INTO public.organizations (id, name, slug)
VALUES ('c1092500-0000-4000-8000-000000000001', 'CI historical replay fixture', 'ci-historical-replay');
INSERT INTO public.org_quotas (organization_id, resource_key, plan_base)
VALUES ('c1092500-0000-4000-8000-000000000001', 'max_leads', 10),
       ('c1092500-0000-4000-8000-000000000001', 'max_funnels', 10)
ON CONFLICT (organization_id, resource_key) DO UPDATE SET plan_base = 10;
INSERT INTO public.leads (id, organization_id, name, rating)
VALUES ('c1092500-0000-4000-8000-000000000002', 'c1092500-0000-4000-8000-000000000001', 'CI synthetic lead', 7);
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('c1092500-0000-4000-8000-000000000003', 'c1092500-0000-4000-8000-000000000001', 'CI synthetic pipeline', 'ci-historical', 'custom');
INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, name, stage_key, position, stage_role)
VALUES ('c1092500-0000-4000-8000-000000000004', 'c1092500-0000-4000-8000-000000000001', 'c1092500-0000-4000-8000-000000000003', 'CI open', 'ci-open', 0, 'open');
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, metadata)
VALUES ('c1092500-0000-4000-8000-000000000005', 'c1092500-0000-4000-8000-000000000001', 'c1092500-0000-4000-8000-000000000003', 'c1092500-0000-4000-8000-000000000002', 'c1092500-0000-4000-8000-000000000004', 'ci-open', '{"calor":7}');
SELECT set_config('request.jwt.claims', '', false);

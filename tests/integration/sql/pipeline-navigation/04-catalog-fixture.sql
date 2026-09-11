-- After idempotence: exercise catalog fallback only for an absent key.
UPDATE public.feature_catalog SET default_enabled=true WHERE key='merged_opportunity_funnel';
INSERT INTO public.organizations (id) VALUES ('20000000-0000-0000-0000-000000000010');
INSERT INTO public.pipelines (id,organization_id,name,slug,type,created_at)
VALUES ('10000000-0000-0000-0000-000000000019','20000000-0000-0000-0000-000000000010','Catalog fallback','confirmacao','system','2026-08-27');
INSERT INTO public.pipeline_display_config (organization_id,pipe_type,display_name)
VALUES ('20000000-0000-0000-0000-000000000010','confirmacao','Catalog fallback');

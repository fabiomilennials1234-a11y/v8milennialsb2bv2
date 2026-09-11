-- Requires the isolated schema slice from 00-preview-schema.sql.
INSERT INTO public.pipelines
(id,organization_id,name,slug,type,display_order,config,created_at,updated_at)
SELECT ('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
       ('20000000-0000-0000-0000-' || lpad(org::text,12,'0'))::uuid,
       'Preserved name ' || n, slug, kind, pos, cfg::jsonb, stamp::timestamptz,
       '2026-08-01'::timestamptz
FROM (VALUES
 (1,1,'whatsapp','system',0,'{"dispatch":{"enabled":true}}','2026-08-27'),
 (2,2,'whatsapp','system',0,'{}','2026-08-27'),
 (3,2,'propostas','system',1,'{}','2026-08-27'),
 (4,2,'confirmacao','system',2,'{}','2026-08-27'),
 (5,1,'permanent','custom',16,'{"team_goal":12345}','2026-08-27'),
 (6,1,'temporary-older','custom',1,'{"lifecycle_type":"temporary"}','2026-08-20'),
 (7,1,'temporary-newer','custom',99,'{"lifecycle_type":"temporary","status":"ended"}','2026-08-26'),
 (8,1,'new-system','system',0,'{}','2026-09-10 21:13:04+00'),
 (9,1,'explicit','custom',0,'{"navigation":{"is_visible":false,"position":42},"other":true}','2026-08-27'),
 (10,3,'confirmacao','system',2,'{}','2026-08-27'),
 (11,1,'inactive','custom',18,'{}','2026-08-27'),
 (12,1,'null-config','custom',17,NULL,'2026-08-27')
) AS v(n,org,slug,kind,pos,cfg,stamp);
UPDATE public.pipelines SET is_active=false WHERE slug='inactive';
INSERT INTO public.pipeline_display_config (organization_id,pipe_type,display_name,is_visible,position)
VALUES
 ('20000000-0000-0000-0000-000000000002','whatsapp','Legacy name',true,6),
 ('20000000-0000-0000-0000-000000000002','propostas','Legacy name',false,2),
 ('20000000-0000-0000-0000-000000000002','confirmacao','Legacy name',true,1),
 ('20000000-0000-0000-0000-000000000003','confirmacao','Legacy name',true,1);
INSERT INTO public.organization_features (organization_id,feature_key,enabled,expires_at)
VALUES
 ('20000000-0000-0000-0000-000000000002','merged_opportunity_funnel',true,NULL),
 ('20000000-0000-0000-0000-000000000003','merged_opportunity_funnel',true,'2020-01-01');
INSERT INTO public.organizations (id,subscription_plan)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
       CASE WHEN n IN (4,5,6) THEN 'merge-plan' ELSE NULL END
FROM generate_series(1,9) n;
INSERT INTO public.subscription_plans (name,features) VALUES ('merge-plan','{"merged_opportunity_funnel":true}');
INSERT INTO public.feature_catalog VALUES ('merged_opportunity_funnel',false);
INSERT INTO public.org_subscriptions (organization_id,features) VALUES
 ('20000000-0000-0000-0000-000000000005','{"merged_opportunity_funnel":false}'),
 ('20000000-0000-0000-0000-000000000007','{"merged_opportunity_funnel":true}'),
 ('20000000-0000-0000-0000-000000000008','{"merged_opportunity_funnel":true}'),
 ('20000000-0000-0000-0000-000000000009','{}');
INSERT INTO public.organization_features (organization_id,feature_key,enabled) VALUES
 ('20000000-0000-0000-0000-000000000006','merged_opportunity_funnel',false),
 ('20000000-0000-0000-0000-000000000008','merged_opportunity_funnel',false);
INSERT INTO public.pipelines (id,organization_id,name,slug,type,created_at)
SELECT ('10000000-0000-0000-0000-' || lpad((n+9)::text,12,'0'))::uuid,
 ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 'Feature precedence ' || n,'confirmacao','system','2026-08-27'
FROM generate_series(4,9) n;
INSERT INTO public.pipeline_display_config (organization_id,pipe_type,display_name,is_visible)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 'confirmacao','Feature precedence ' || n,true FROM generate_series(4,9) n;
CREATE TABLE public.navigation_before AS SELECT to_jsonb(p) AS row FROM public.pipelines p;
CREATE TABLE public.display_before AS SELECT to_jsonb(d) AS row FROM public.pipeline_display_config d;
CREATE TABLE public.features_before AS SELECT to_jsonb(f) AS row FROM public.organization_features f;

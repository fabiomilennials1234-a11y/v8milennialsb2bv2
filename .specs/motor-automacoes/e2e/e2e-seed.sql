-- Seed E2E do motor de automações (branch descartável).
-- Duas coortes desenhadas para DISCRIMINAR a ordenação:
--   ATRASADA : venceu há 10 min, NASCEU há 1 min    -> tem que ser pega PRIMEIRO
--   RECENTE  : venceu há 1 s,   NASCEU há 10 dias   -> ordenação velha pegaria esta
insert into subscription_plans (id, name, display_name, features)
values ('99999999-9999-9999-9999-999999999999','pro','E2E Pro','{"automations": true}'::jsonb)
on conflict (id) do update set features = excluded.features;

insert into organizations (id, name, slug, subscription_plan) values
 ('11111111-1111-1111-1111-111111111111','E2E Org A','e2e-org-a','pro'),
 ('22222222-2222-2222-2222-222222222222','E2E Org B','e2e-org-b','pro'),
 ('33333333-3333-3333-3333-333333333333','E2E Org C','e2e-org-c','pro')
on conflict (id) do nothing;

insert into workflows (id, organization_id, name, trigger_type, is_active, definition)
select ('aaaaaaaa-0000-0000-0000-00000000000' || right(o.slug,1))::uuid, o.id,
       'E2E ' || o.name, 'lead_created', true,
       '{"nodes":[{"id":"t1","type":"trigger","data":{"label":"Trigger"}},
                  {"id":"e1","type":"end","data":{"label":"Fim"}}],
         "edges":[{"id":"x1","source":"t1","target":"e1"}]}'::jsonb
from organizations o where o.slug like 'e2e-%'
on conflict (id) do nothing;

insert into workflow_executions (workflow_id, organization_id, status, started_at, next_run_at, context, loop_counters)
select w.id, w.organization_id, 'running',
       now() - interval '1 minute', now() - interval '10 minutes', '{"coorte":"atrasada"}'::jsonb, '{}'::jsonb
from workflows w join organizations o on o.id = w.organization_id and o.slug like 'e2e-%'
cross join generate_series(1, case when o.slug = 'e2e-org-c' then 3 else 15 end);

insert into workflow_executions (workflow_id, organization_id, status, started_at, next_run_at, context, loop_counters)
select w.id, w.organization_id, 'running',
       now() - interval '10 days', now() - interval '1 second', '{"coorte":"recente"}'::jsonb, '{}'::jsonb
from workflows w join organizations o on o.id = w.organization_id and o.slug like 'e2e-%'
cross join generate_series(1, case when o.slug = 'e2e-org-c' then 3 else 15 end);

select context->>'coorte' as coorte, count(*) from workflow_executions group by 1 order by 1;
select org_get_features_and_limits('11111111-1111-1111-1111-111111111111')->'features'->'automations' as gate_automations;

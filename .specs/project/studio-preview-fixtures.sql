-- Somente preview sem dados reais; runner bloqueia produção.
-- Fixture administrativa, sem contornar os triggers de quota/tenancy.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
INSERT INTO public.organizations (id, name, slug)
VALUES ('11111111-1111-4111-8111-111111111111', 'Studio QA A', 'studio-qa-a'),
       ('22222222-2222-4222-8222-222222222222', 'Studio QA B', 'studio-qa-b');
INSERT INTO public.org_quotas (organization_id, resource_key, plan_base)
VALUES ('11111111-1111-4111-8111-111111111111', 'max_users', 5)
ON CONFLICT (organization_id, resource_key) DO UPDATE SET plan_base = 5;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authenticated', 'authenticated', 'studio-admin@example.test', now(), '{}', '{}'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'authenticated', 'authenticated', 'studio-member@example.test', now(), '{}', '{}'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'authenticated', 'authenticated', 'studio-master@example.test', now(), '{}', '{}');
INSERT INTO public.team_members (id, user_id, name, role, organization_id)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Admin QA', 'admin', '11111111-1111-4111-8111-111111111111'),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Member QA', 'member', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.master_users (user_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
INSERT INTO public.metrics_studio_panels (id, organization_id, nome, ordem, layout)
VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '11111111-1111-4111-8111-111111111111', 'Painel autoral preservado', 8, '[{"id":"original","metricId":"receita","corte":"total","chart":"number","x":16,"y":16,"w":280,"h":132,"z":1}]');

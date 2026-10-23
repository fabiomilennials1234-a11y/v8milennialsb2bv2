-- supabase/tests/contatos_crud_test.sql
--
-- Chamado 33c5fd52 · PR6: CRUD de contatos independente de lead e empresa
-- (migration 20271129000000_contatos_crud_lead_contacts.sql).
--
--   (GR) grants: escrita direta fechada; anon sem nada; helpers internos fechados
--   (IX) índice de telefone de contacts deixou de ser único
--   (KS) keystone: cria SEM lead e SEM empresa, vincula a 2 leads, edita, exclui
--   (PH) telefones: mesmo número em 2 contatos, principal espelhado, inválido
--   (RL) RLS/RPC: visibilidade herdada do lead, multi-org, master, anon
--
-- Usa só ok/is/isnt/throws_ok/lives_ok (pgTAP). Roda inteiro em transação
-- revertida. Personas: a1 admin da org A (vê todos os leads), a2 membro
-- restrito da org A (só o lead que é dele), b1 admin da org B, c1 master.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (gatilhos desligados: só a estrutura que o teste precisa)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('33c5fd52-0000-4000-8000-00000000000a', 'Org CT A', 'org-ct-a', 'America/Sao_Paulo'),
  ('33c5fd52-0000-4000-8000-00000000000b', 'Org CT B', 'org-ct-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('33c5fd52-0000-4000-8000-0000000000a1', 'ct-admin-a@test.local'),
    ('33c5fd52-0000-4000-8000-0000000000a2', 'ct-membro-a@test.local'),
    ('33c5fd52-0000-4000-8000-0000000000a3', 'ct-sem-view-a@test.local'),
    ('33c5fd52-0000-4000-8000-0000000000b1', 'ct-admin-b@test.local'),
    ('33c5fd52-0000-4000-8000-0000000000c1', 'ct-master@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('33c5fd52-0000-4000-8000-0000000001a1', '33c5fd52-0000-4000-8000-00000000000a', '33c5fd52-0000-4000-8000-0000000000a1', 'Admin A',  'admin',  true),
  ('33c5fd52-0000-4000-8000-0000000001a2', '33c5fd52-0000-4000-8000-00000000000a', '33c5fd52-0000-4000-8000-0000000000a2', 'Membro A', 'member', true),
  ('33c5fd52-0000-4000-8000-0000000001a3', '33c5fd52-0000-4000-8000-00000000000a', '33c5fd52-0000-4000-8000-0000000000a3', 'Sem view A', 'member', true),
  ('33c5fd52-0000-4000-8000-0000000001b1', '33c5fd52-0000-4000-8000-00000000000b', '33c5fd52-0000-4000-8000-0000000000b1', 'Admin B',  'admin',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('33c5fd52-0000-4000-8000-0000000000c1', true);

-- a3: membro da org A com o override individual leads.view = false.
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
VALUES ('33c5fd52-0000-4000-8000-0000000001a3', '33c5fd52-0000-4000-8000-00000000000a', 'leads.view', false);

-- Org A restrita: membro só vê/edita o lead pelo qual responde.
INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled) VALUES
  ('33c5fd52-0000-4000-8000-00000000000a', 'leads.view_all', false),
  ('33c5fd52-0000-4000-8000-00000000000a', 'leads.view_unassigned', false),
  ('33c5fd52-0000-4000-8000-00000000000a', 'leads.view_subordinates', false);

--   LA1 e LA2 org A (LA1 é do membro a2; LA2 é de ninguém) · LB1 org B
INSERT INTO public.leads (id, organization_id, name, origin, sale_responsible_id, closer_id, created_at) VALUES
  ('33c5fd52-0000-4000-8000-0000000002a1', '33c5fd52-0000-4000-8000-00000000000a', 'LA1', 'meta_ads', '33c5fd52-0000-4000-8000-0000000001a2', '33c5fd52-0000-4000-8000-0000000001a2', now()),
  ('33c5fd52-0000-4000-8000-0000000002a2', '33c5fd52-0000-4000-8000-00000000000a', 'LA2', 'meta_ads', NULL, NULL, now()),
  ('33c5fd52-0000-4000-8000-0000000002b1', '33c5fd52-0000-4000-8000-00000000000b', 'LB1', 'meta_ads', '33c5fd52-0000-4000-8000-0000000001b1', '33c5fd52-0000-4000-8000-0000000001b1', now())
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(has_table_privilege('authenticated', 'public.contacts', 'SELECT')
      AND has_table_privilege('authenticated', 'public.lead_contacts', 'SELECT')
      AND has_table_privilege('authenticated', 'public.contact_phones', 'SELECT'),
  'GR1: authenticated lê as três tabelas (a RLS decide o quê)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.contacts', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.contacts', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.contacts', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.lead_contacts', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.lead_contacts', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.contact_phones', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.contact_phones', 'UPDATE'),
  'GR2: authenticated não escreve direto em contacts/lead_contacts/contact_phones');
SELECT ok(NOT has_table_privilege('anon', 'public.contacts', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.lead_contacts', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.contact_phones', 'SELECT'),
  'GR3: anon não tem nada nas três tabelas');
SELECT ok(NOT has_function_privilege('anon', 'public.contact_create(uuid, text, text, jsonb, text, uuid[])', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.contact_update(uuid, text, text, jsonb, text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.contact_delete(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.lead_contact_link(uuid, uuid, text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.lead_contact_unlink(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.contact_list(uuid, text, integer, integer)', 'EXECUTE'),
  'GR4: anon não executa nenhuma RPC');
SELECT ok(has_function_privilege('authenticated', 'public.contact_create(uuid, text, text, jsonb, text, uuid[])', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.lead_contact_link(uuid, uuid, text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.contact_list(uuid, text, integer, integer)', 'EXECUTE'),
  'GR5: authenticated executa as RPCs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contact_set_phones(uuid, uuid, jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.contact_link_lead_internal(uuid, uuid, uuid, text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.contact_has_links(uuid)', 'EXECUTE'),
  'GR6: helpers internos fechados para clientes');
SELECT ok(NOT has_function_privilege('authenticated', 'public.migrate_leads_to_contacts_companies(integer)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.migrate_leads_to_contacts_companies(integer)', 'EXECUTE'),
  'GR7: a função herdada que nunca rodou não é executável por logado');
SELECT is(
  (SELECT count(*)::int FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid IN ('public.contacts'::regclass, 'public.lead_contacts'::regclass, 'public.contact_phones'::regclass)
      AND a.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = 'anon'))),
  0, 'GR8: relacl das três tabelas não tem entrada para PUBLIC nem anon');

-- ===========================================================================
-- (IX) índice de telefone deixou de ser único
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'idx_contacts_org_phone_unique'),
  0, 'IX1: índice único de telefone saiu');
SELECT is((SELECT i.indisunique FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.relname = 'idx_contacts_org_normalized_phone'),
  false, 'IX2: o índice que o substitui é NÃO único');

-- ===========================================================================
-- (KS) keystone: sem lead, sem empresa -> 2 leads -> edita -> exclui
-- ===========================================================================
SET LOCAL role authenticated;
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a1');

SELECT set_config('t.c1', public.contact_create(
  '33c5fd52-0000-4000-8000-00000000000a', '  Maria Compras ', 'Maria@Cafe.com',
  '[{"phone":"(48) 99999-1111","label":"Celular"},{"phone":"4833334444","label":"Fixo"}]'::jsonb,
  'Compradora')::text, true);

SELECT ok(NULLIF(current_setting('t.c1', true), '') IS NOT NULL, 'KS1: contact_create devolve o id (sem lead, sem empresa)');
SELECT is((SELECT c.company_id IS NULL AND c.source_lead_id IS NULL FROM public.contacts c WHERE c.id = current_setting('t.c1')::uuid),
  true, 'KS2: contato nasce sem empresa e sem lead');
SELECT is((SELECT c.name || '|' || c.email FROM public.contacts c WHERE c.id = current_setting('t.c1')::uuid),
  'Maria Compras|maria@cafe.com', 'KS3: nome com trim, e-mail em minúsculas');
SELECT is((public.contact_list('33c5fd52-0000-4000-8000-00000000000a') ->> 'total')::int, 1,
  'KS4: contact_list enxerga o contato recém-criado');

SELECT lives_ok(
  $q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002a1', current_setting('t.c1')::uuid, 'comprador')$q$,
  'KS5: vincula ao lead 1');
SELECT lives_ok(
  $q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002a2', current_setting('t.c1')::uuid, 'financeiro')$q$,
  'KS6: vincula ao lead 2');
SELECT lives_ok(
  $q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002a2', current_setting('t.c1')::uuid, 'financeiro')$q$,
  'KS7: vincular de novo é idempotente');
SELECT is((SELECT count(*)::int FROM public.lead_contacts WHERE contact_id = current_setting('t.c1')::uuid),
  2, 'KS8: exatamente 2 vínculos');
SELECT is(jsonb_array_length(public.contact_list('33c5fd52-0000-4000-8000-00000000000a') -> 'rows' -> 0 -> 'leads'),
  2, 'KS9: contact_list mostra os 2 leads do contato');

SELECT lives_ok(
  $q$SELECT public.contact_update(current_setting('t.c1')::uuid, 'Maria Silva', NULL,
       '[{"phone":"48988887777","is_primary":true}]'::jsonb, NULL)$q$,
  'KS10: edita nome, limpa e-mail, troca telefones');
SELECT is((SELECT c.name || '|' || COALESCE(c.email, '-') || '|' || c.normalized_phone FROM public.contacts c WHERE c.id = current_setting('t.c1')::uuid),
  'Maria Silva|-|48988887777', 'KS11: edição gravou e espelhou o telefone principal');
SELECT is((SELECT count(*)::int FROM public.contact_phones WHERE contact_id = current_setting('t.c1')::uuid),
  1, 'KS12: a lista de telefones foi substituída');
SELECT is((SELECT count(*)::int FROM public.lead_contacts WHERE contact_id = current_setting('t.c1')::uuid),
  2, 'KS13: editar não mexe nos vínculos');

SELECT lives_ok(
  $q$SELECT public.lead_contact_unlink('33c5fd52-0000-4000-8000-0000000002a2', current_setting('t.c1')::uuid)$q$,
  'KS14: desvincula do lead 2');
SELECT is((SELECT count(*)::int FROM public.lead_contacts WHERE contact_id = current_setting('t.c1')::uuid),
  1, 'KS15: sobra 1 vínculo');

SELECT lives_ok($q$SELECT public.contact_delete(current_setting('t.c1')::uuid)$q$, 'KS16: exclui o contato');
SELECT is((public.contact_list('33c5fd52-0000-4000-8000-00000000000a') ->> 'total')::int, 0,
  'KS17: contato excluído some da lista');
SELECT is((SELECT count(*)::int FROM public.lead_contacts WHERE contact_id = current_setting('t.c1')::uuid),
  0, 'KS18: exclusão apaga os vínculos');
SELECT throws_ok($q$SELECT public.contact_update(current_setting('t.c1')::uuid, 'X', NULL, '[]'::jsonb, NULL)$q$,
  'PT404', NULL, 'KS19: editar contato excluído = PT404');
SELECT throws_ok($q$SELECT public.contact_delete(current_setting('t.c1')::uuid)$q$,
  'PT404', NULL, 'KS20: excluir de novo = PT404');

RESET role;
SET LOCAL role postgres;
SELECT is((SELECT (c.deleted_at IS NOT NULL AND c.deleted_by = '33c5fd52-0000-4000-8000-0000000000a1')
             FROM public.contacts c WHERE c.id = current_setting('t.c1')::uuid),
  true, 'KS21: exclusão é soft (deleted_at/deleted_by preenchidos)');

-- ===========================================================================
-- (PH) telefones
-- ===========================================================================
SET LOCAL role authenticated;
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a1');

SELECT set_config('t.p1', public.contact_create(
  '33c5fd52-0000-4000-8000-00000000000a', 'Contato P1', NULL,
  '[{"phone":"48 91234-5678"}]'::jsonb)::text, true);
SELECT lives_ok($q$SELECT set_config('t.p2', public.contact_create(
  '33c5fd52-0000-4000-8000-00000000000a', 'Contato P2', NULL,
  '[{"phone":"+55 (48) 91234-5678"}]'::jsonb)::text, true)$q$,
  'PH1: o MESMO número em outro contato da org é permitido');
SELECT is((SELECT count(*)::int FROM public.contacts
            WHERE organization_id = '33c5fd52-0000-4000-8000-00000000000a'
              AND normalized_phone = '48912345678' AND deleted_at IS NULL),
  2, 'PH2: os dois contatos guardam o mesmo número normalizado');
SELECT throws_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Ruim', NULL,
  '[{"phone":"123"}]'::jsonb)$q$, 'PT422', NULL, 'PH3: telefone curto demais = PT422');
SELECT throws_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', '   ', NULL, '[]'::jsonb)$q$,
  'PT422', NULL, 'PH4: nome em branco = PT422');
SELECT throws_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Mail', 'sem-arroba', '[]'::jsonb)$q$,
  'PT422', NULL, 'PH5: e-mail inválido = PT422');
SELECT lives_ok($q$SELECT set_config('t.p3', public.contact_create(
  '33c5fd52-0000-4000-8000-00000000000a', 'Contato P3', NULL,
  '[{"phone":"48911112222"},{"phone":"(48) 91111-2222"},{"phone":"48933334444","is_primary":true}]'::jsonb)::text, true)$q$,
  'PH6: número repetido no mesmo contato é ignorado');
SELECT is((SELECT count(*)::int FROM public.contact_phones WHERE contact_id = current_setting('t.p3')::uuid),
  2, 'PH7: sobram 2 telefones distintos');
SELECT is((SELECT c.normalized_phone FROM public.contacts c WHERE c.id = current_setting('t.p3')::uuid),
  '48933334444', 'PH8: o principal marcado é o que fica espelhado em contacts');
SELECT is((SELECT count(*)::int FROM public.contact_phones WHERE contact_id = current_setting('t.p3')::uuid AND is_primary),
  1, 'PH9: um único principal');
SELECT is((public.contact_list('33c5fd52-0000-4000-8000-00000000000a', '91234', 50, 0) ->> 'total')::int, 2,
  'PH10: busca por pedaço do número acha os dois contatos');
SELECT is((public.contact_list('33c5fd52-0000-4000-8000-00000000000a', 'Contato P3', 50, 0) ->> 'total')::int, 1,
  'PH11: busca por nome');
SELECT is((public.contact_list('33c5fd52-0000-4000-8000-00000000000a', '100%', 50, 0) ->> 'total')::int, 0,
  'PH12: % na busca é literal, não curinga');

-- ===========================================================================
-- (RL) RLS / autorização
-- ===========================================================================
-- Contato do membro restrito: ligado ao lead dele (LA1) e ao LA2 (que ele não vê).
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a1');
SELECT set_config('t.r1', public.contact_create(
  '33c5fd52-0000-4000-8000-00000000000a', 'Contato R1', NULL, '[]'::jsonb, NULL,
  ARRAY['33c5fd52-0000-4000-8000-0000000002a2']::uuid[])::text, true);
SELECT set_config('t.r2', public.contact_create(
  '33c5fd52-0000-4000-8000-00000000000a', 'Contato R2', NULL, '[]'::jsonb, NULL,
  ARRAY['33c5fd52-0000-4000-8000-0000000002a1']::uuid[])::text, true);
SELECT is((SELECT count(*)::int FROM public.lead_contacts WHERE contact_id = current_setting('t.r1')::uuid),
  1, 'RL1: contact_create já vincula ao lead informado');

-- Membro restrito (a2)
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a2');
SELECT is((SELECT count(*)::int FROM public.contacts WHERE id = current_setting('t.r2')::uuid),
  1, 'RL2: membro vê o contato ligado ao lead que é dele');
SELECT is((SELECT count(*)::int FROM public.contacts WHERE id = current_setting('t.r1')::uuid),
  0, 'RL3: membro NÃO vê contato ligado só a lead que ele não enxerga');
SELECT is((SELECT count(*)::int FROM public.contacts WHERE id = current_setting('t.p1')::uuid),
  1, 'RL4: contato sem vínculo é visível à org');
SELECT is((SELECT count(*)::int FROM public.lead_contacts WHERE contact_id = current_setting('t.r1')::uuid),
  0, 'RL5: membro não vê o vínculo com lead alheio');
SELECT throws_ok($q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002a2', current_setting('t.p1')::uuid, NULL)$q$,
  '42501', NULL, 'RL6: membro não vincula contato a lead que não pode alterar');
SELECT lives_ok($q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002a1', current_setting('t.p1')::uuid, 'compras')$q$,
  'RL7: membro vincula ao lead que é dele');
SELECT throws_ok($q$SELECT public.lead_contact_unlink('33c5fd52-0000-4000-8000-0000000002a2', current_setting('t.r1')::uuid)$q$,
  '42501', NULL, 'RL8: membro não desvincula de lead que não pode alterar');

-- Escrita direta é recusada
SELECT throws_ok($q$INSERT INTO public.contacts (organization_id, name) VALUES ('33c5fd52-0000-4000-8000-00000000000a', 'Direto')$q$,
  '42501', NULL, 'RL9: INSERT direto em contacts é recusado');
SELECT throws_ok($q$UPDATE public.contacts SET name = 'Hack'$q$,
  '42501', NULL, 'RL10: UPDATE direto em contacts é recusado');
SELECT throws_ok($q$DELETE FROM public.lead_contacts$q$,
  '42501', NULL, 'RL11: DELETE direto em lead_contacts é recusado');

-- Outra org (b1)
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000b1');
SELECT is((SELECT count(*)::int FROM public.contacts WHERE organization_id = '33c5fd52-0000-4000-8000-00000000000a'),
  0, 'RL12: org B não vê contato da org A');
SELECT is((public.contact_list('33c5fd52-0000-4000-8000-00000000000a') ->> 'total')::int, 0,
  'RL13: contact_list da org A pela org B volta vazio');
SELECT throws_ok($q$SELECT public.contact_update(current_setting('t.p1')::uuid, 'Sequestro', NULL, '[]'::jsonb, NULL)$q$,
  'PT404', NULL, 'RL14: org B não edita contato da org A');
SELECT throws_ok($q$SELECT public.contact_delete(current_setting('t.p1')::uuid)$q$,
  'PT404', NULL, 'RL15: org B não exclui contato da org A');
SELECT throws_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Intruso', NULL, '[]'::jsonb)$q$,
  'P0001', NULL, 'RL16: org B não cria contato na org A (access_denied)');
SELECT throws_ok($q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002b1', current_setting('t.p1')::uuid, NULL)$q$,
  'PT404', NULL, 'RL17: não vincula contato da org A a lead da org B');

-- Master
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000c1');
SELECT is((SELECT count(*)::int FROM public.contacts WHERE id IN (current_setting('t.r1')::uuid, current_setting('t.r2')::uuid)),
  2, 'RL18: master vê contatos de qualquer org');
SELECT lives_ok($q$SELECT public.contact_update(current_setting('t.r1')::uuid, 'Contato R1 (master)', NULL, '[]'::jsonb, NULL)$q$,
  'RL19: master edita contato de tenant');
SELECT throws_ok($q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002b1', current_setting('t.p1')::uuid, NULL)$q$,
  'PT404', NULL, 'RL20: nem master cruza org (contato A x lead B)');

-- Permissão leads.view (a3: membro da org A com override leads.view = false)
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a3');
SELECT throws_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Sem view', NULL, '[]'::jsonb)$q$,
  '42501', 'Você não tem permissão para gerenciar contatos.', 'PM1: sem leads.view não cria contato');
SELECT throws_ok($q$SELECT public.contact_update(current_setting('t.p1')::uuid, 'X', NULL, '[]'::jsonb, NULL)$q$,
  '42501', 'Você não tem permissão para gerenciar contatos.', 'PM2: sem leads.view não edita contato');
SELECT throws_ok($q$SELECT public.contact_delete(current_setting('t.p1')::uuid)$q$,
  '42501', 'Você não tem permissão para gerenciar contatos.', 'PM3: sem leads.view não exclui contato');
SELECT throws_ok($q$SELECT public.lead_contact_link('33c5fd52-0000-4000-8000-0000000002a1', current_setting('t.p1')::uuid, NULL)$q$,
  '42501', 'Você não tem permissão para gerenciar contatos.', 'PM4: sem leads.view não vincula');
SELECT throws_ok($q$SELECT public.lead_contact_unlink('33c5fd52-0000-4000-8000-0000000002a1', current_setting('t.p1')::uuid)$q$,
  '42501', 'Você não tem permissão para gerenciar contatos.', 'PM5: sem leads.view não desvincula');
SELECT lives_ok($q$SELECT public.contact_list('33c5fd52-0000-4000-8000-00000000000a')$q$,
  'PM6: contact_list segue invoker (a leitura é da RLS, não da permissão de escrita)');
SELECT is((SELECT count(*)::int FROM public.contacts WHERE id = current_setting('t.p2')::uuid),
  1, 'PM7: contato solto continua visível à org inteira, mesmo sem leads.view');

RESET role;
SET LOCAL role postgres;
UPDATE public.member_feature_permissions SET enabled = true
 WHERE team_member_id = '33c5fd52-0000-4000-8000-0000000001a3' AND feature_key = 'leads.view';
SET LOCAL role authenticated;
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a3');
SELECT lives_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Com view', NULL, '[]'::jsonb)$q$,
  'PM8: com leads.view (override ligado) o mesmo membro cria');
SELECT lives_ok($q$SELECT public.contact_update(current_setting('t.p1')::uuid, 'Contato P1 editado', NULL, '[]'::jsonb, NULL)$q$,
  'PM9: com leads.view edita');

RESET role;
SET LOCAL role postgres;
DELETE FROM public.member_feature_permissions WHERE team_member_id = '33c5fd52-0000-4000-8000-0000000001a3';
SET LOCAL role authenticated;
SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a3');
SELECT lives_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Default do catálogo', NULL, '[]'::jsonb)$q$,
  'PM10: sem override, vale o default do catálogo (leads.view = true)');

SELECT pg_temp.as_user('33c5fd52-0000-4000-8000-0000000000a1');
SELECT lives_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Admin', NULL, '[]'::jsonb)$q$,
  'PM11: admin da org passa');

-- anon
RESET role;
SET LOCAL role anon;
SELECT throws_ok($q$SELECT public.contact_list('33c5fd52-0000-4000-8000-00000000000a')$q$,
  '42501', NULL, 'RL21: anon não executa contact_list');
SELECT throws_ok($q$SELECT public.contact_create('33c5fd52-0000-4000-8000-00000000000a', 'Anon', NULL, '[]'::jsonb)$q$,
  '42501', NULL, 'RL22: anon não executa contact_create');
SELECT throws_ok($q$SELECT count(*) FROM public.contacts$q$,
  '42501', NULL, 'RL23: anon não lê contacts');

RESET role;
SELECT * FROM finish();

ROLLBACK;

-- supabase/tests/lead_documents_test.sql
--
-- Chamado 93027ffb: CPF/CNPJ editável no lead como override local com trilha
-- (migration 20271110000000_lead_documents_override.sql).
--
--   (DV) is_valid_br_document: DV, placeholder, tamanho, só dígitos.
--   (GR) GRANTs provados por pg_class.relacl (role_table_grants mente por
--        omissão): authenticated só SELECT; anon e PUBLIC nada.
--   (ED) a RPC: normaliza, grava, recusa DV inválido, unicidade na org contra
--        override de outro lead E contra o documento do ERP de outro lead,
--        igual ao ERP = sem override, clear apaga e registra, estado de
--        write-back nao_aplicavel/pendente.
--   (PE) permissão: membro sem leads.edit_document recusado; membro que não
--        edita o lead recusado; admin aceito; master aceito.
--   (XO) usuário de outra org não enxerga o lead.
--   (AO) trilha append-only e nenhuma escrita direta pelo cliente.
--   (SY) a RPC nunca toca upsell_clients.
--   (DR) can_update_lead == USING da policy de UPDATE de leads, medido por
--        SELECT ... FOR KEY SHARE como authenticated.
--
-- Documentos: todos SINTÉTICOS, gerados aqui a partir de bases inventadas.
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Gerador de documento sintético. Formulação independente da função testada:
-- resto da soma ponderada, DV = 0 quando resto < 2, senão 11 - resto.
-- ===========================================================================
CREATE FUNCTION pg_temp.dv(p_base text, p_pesos int[]) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN s % 11 < 2 THEN '0' ELSE (11 - s % 11)::text END
    FROM (SELECT sum(substr(p_base, i, 1)::int * p_pesos[i]) AS s
            FROM generate_series(1, length(p_base)) AS i) t
$$;

CREATE FUNCTION pg_temp.cpf(p_base9 text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT b || pg_temp.dv(b, ARRAY[11,10,9,8,7,6,5,4,3,2])
    FROM (SELECT p_base9 || pg_temp.dv(p_base9, ARRAY[10,9,8,7,6,5,4,3,2]) AS b) t
$$;

CREATE FUNCTION pg_temp.cnpj(p_base12 text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT b || pg_temp.dv(b, ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2])
    FROM (SELECT p_base12 || pg_temp.dv(p_base12, ARRAY[5,4,3,2,9,8,7,6,5,4,3,2]) AS b) t
$$;

CREATE TEMP TABLE t_docs (k text PRIMARY KEY, v text NOT NULL);
INSERT INTO t_docs VALUES
  ('cnpj_a', pg_temp.cnpj('112223330001')),
  ('cnpj_b', pg_temp.cnpj('445556660001')),
  ('cnpj_c', pg_temp.cnpj('998877660001')),
  ('cpf_a',  pg_temp.cpf('135792468')),
  ('erp_2',  pg_temp.cnpj('778889990001')),
  ('erp_3',  pg_temp.cnpj('224466880001'));
GRANT SELECT ON t_docs TO authenticated, anon;

CREATE FUNCTION pg_temp.doc(p_k text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT v FROM t_docs WHERE k = p_k $$;

-- Troca o DV final: mesmo tamanho, DV errado.
CREATE FUNCTION pg_temp.dv_errado(p_doc text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT left(p_doc, -1) || ((right(p_doc, 1)::int + 1) % 10)::text
$$;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('93027ffb-0000-4000-8000-00000000000a', 'Org DOC A', 'org-doc-a', 'America/Sao_Paulo'),
  ('93027ffb-0000-4000-8000-00000000000b', 'Org DOC B', 'org-doc-b', 'America/Sao_Paulo')
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
    ('93027ffb-0000-4000-8000-0000000000a1', 'doc-admin@test.local'),
    ('93027ffb-0000-4000-8000-0000000000a2', 'doc-editor@test.local'),
    ('93027ffb-0000-4000-8000-0000000000a3', 'doc-semperm@test.local'),
    ('93027ffb-0000-4000-8000-0000000000a4', 'doc-alheio@test.local'),
    ('93027ffb-0000-4000-8000-0000000000b1', 'doc-org-b@test.local'),
    ('93027ffb-0000-4000-8000-0000000000c1', 'doc-master@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('93027ffb-0000-4000-8000-0000000001a1', '93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000000a1', 'Admin A',   'admin',  true),
  ('93027ffb-0000-4000-8000-0000000001a2', '93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000000a2', 'Editor A',  'member', true),
  ('93027ffb-0000-4000-8000-0000000001a3', '93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000000a3', 'Sem perm A','member', true),
  ('93027ffb-0000-4000-8000-0000000001a4', '93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000000a4', 'Alheio A',  'member', true),
  ('93027ffb-0000-4000-8000-0000000001b1', '93027ffb-0000-4000-8000-00000000000b', '93027ffb-0000-4000-8000-0000000000b1', 'Admin B',   'admin',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('93027ffb-0000-4000-8000-0000000000c1', true);

-- Na org A, membro só edita lead pelo qual responde: sem ver tudo, sem
-- "não atribuídos", sem "subordinados".
INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled) VALUES
  ('93027ffb-0000-4000-8000-00000000000a', 'leads.view_all', false),
  ('93027ffb-0000-4000-8000-00000000000a', 'leads.view_unassigned', false),
  ('93027ffb-0000-4000-8000-00000000000a', 'leads.view_subordinates', false);

-- Editor e Alheio têm a permissão nova; Sem perm não (default do catálogo = false).
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('93027ffb-0000-4000-8000-0000000001a2', '93027ffb-0000-4000-8000-00000000000a', 'leads.edit_document', true),
  ('93027ffb-0000-4000-8000-0000000001a4', '93027ffb-0000-4000-8000-00000000000a', 'leads.edit_document', true);

INSERT INTO public.leads (id, organization_id, name, origin, sale_responsible_id, pre_sale_responsible_id, closer_id, created_at) VALUES
  ('93027ffb-0000-4000-8000-0000000002a1', '93027ffb-0000-4000-8000-00000000000a', 'Lead A1 sem ERP',  'meta_ads', '93027ffb-0000-4000-8000-0000000001a2', '93027ffb-0000-4000-8000-0000000001a3', '93027ffb-0000-4000-8000-0000000001a1', now()),
  ('93027ffb-0000-4000-8000-0000000002a2', '93027ffb-0000-4000-8000-00000000000a', 'Lead A2 com ERP',  'meta_ads', '93027ffb-0000-4000-8000-0000000001a2', NULL, '93027ffb-0000-4000-8000-0000000001a1', now()),
  ('93027ffb-0000-4000-8000-0000000002a3', '93027ffb-0000-4000-8000-00000000000a', 'Lead A3 com ERP',  'meta_ads', '93027ffb-0000-4000-8000-0000000001a2', NULL, '93027ffb-0000-4000-8000-0000000001a1', now()),
  ('93027ffb-0000-4000-8000-0000000002a4', '93027ffb-0000-4000-8000-00000000000a', 'Lead A4 sem ERP',  'meta_ads', '93027ffb-0000-4000-8000-0000000001a2', NULL, '93027ffb-0000-4000-8000-0000000001a1', now()),
  ('93027ffb-0000-4000-8000-0000000002b1', '93027ffb-0000-4000-8000-00000000000b', 'Lead B1',          'meta_ads', '93027ffb-0000-4000-8000-0000000001b1', NULL, '93027ffb-0000-4000-8000-0000000001b1', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.upsell_clients (organization_id, lead_id, name, cnpj, external_source, external_id) VALUES
  ('93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000002a2', 'Cliente A2', pg_temp.doc('erp_2'), 'toth', 'doc-test-2'),
  ('93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000002a3', 'Cliente A3', pg_temp.doc('erp_3'), 'toth', 'doc-test-3');

-- Daqui em diante os triggers valem (append-only incluído).
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (DV) A regra do documento
-- ===========================================================================
SELECT ok(public.is_valid_br_document(pg_temp.doc('cnpj_a')), 'DV1: CNPJ sintético com DV certo é válido');
SELECT ok(public.is_valid_br_document(pg_temp.doc('cpf_a')),  'DV2: CPF sintético com DV certo é válido');
SELECT ok(NOT public.is_valid_br_document(pg_temp.dv_errado(pg_temp.doc('cnpj_a'))), 'DV3: CNPJ com DV errado é inválido');
SELECT ok(NOT public.is_valid_br_document(pg_temp.dv_errado(pg_temp.doc('cpf_a'))),  'DV4: CPF com DV errado é inválido');
SELECT ok(NOT public.is_valid_br_document(repeat('0', 14)), 'DV5: placeholder de zeros do Toth é inválido');
SELECT ok(NOT public.is_valid_br_document(repeat('1', 11)), 'DV6: dígitos repetidos (DV fecha) são inválidos');
SELECT ok(NOT public.is_valid_br_document(left(pg_temp.doc('cnpj_a'), 13)), 'DV7: 13 dígitos é inválido');
SELECT ok(NOT public.is_valid_br_document(NULL), 'DV8: NULL é inválido');
SELECT ok(NOT public.is_valid_br_document(
  substr(pg_temp.doc('cnpj_a'),1,2) || '.' || substr(pg_temp.doc('cnpj_a'),3,3) || '.' || substr(pg_temp.doc('cnpj_a'),6,3)
  || '/' || substr(pg_temp.doc('cnpj_a'),9,4) || '-' || substr(pg_temp.doc('cnpj_a'),13,2)),
  'DV9: a função recebe só dígitos; normalizar é trabalho da RPC');

-- ===========================================================================
-- (GR) GRANTs pela fonte da verdade: pg_class.relacl
-- ===========================================================================
SELECT is(
  (SELECT array_agg(a.privilege_type::text ORDER BY a.privilege_type)
     FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.lead_documents'::regclass AND a.grantee = 'authenticated'::regrole),
  ARRAY['SELECT'], 'GR1: authenticated só tem SELECT em lead_documents (relacl)');
SELECT is(
  (SELECT array_agg(a.privilege_type::text ORDER BY a.privilege_type)
     FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.lead_document_events'::regclass AND a.grantee = 'authenticated'::regrole),
  ARRAY['SELECT'], 'GR2: authenticated só tem SELECT em lead_document_events (relacl)');
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid IN ('public.lead_documents'::regclass, 'public.lead_document_events'::regclass)
      AND a.grantee IN ('anon'::regrole, 0::oid)),
  0, 'GR3: anon e PUBLIC sem privilégio nenhum nas duas tabelas (relacl)');
SELECT is(
  (SELECT array_agg(a.privilege_type::text ORDER BY a.privilege_type)
     FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.lead_document_events'::regclass AND a.grantee = 'service_role'::regrole),
  ARRAY['INSERT','SELECT'], 'GR4: nem service_role altera ou apaga a trilha (relacl)');
SELECT ok(NOT has_function_privilege('anon', 'public.set_lead_document(uuid,text)', 'EXECUTE'),
  'GR5: anon não executa set_lead_document');
SELECT ok(has_function_privilege('authenticated', 'public.set_lead_document(uuid,text)', 'EXECUTE'),
  'GR6: authenticated executa set_lead_document (a ficha chama do navegador)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.can_update_lead(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.can_update_lead(uuid)', 'EXECUTE'),
  'GR7: can_update_lead é interno das RPCs DEFINER');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_documents'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_document_events'::regclass),
  'GR8: RLS ligada nas duas tabelas');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('lead_documents','lead_document_events')
      AND cmd <> 'SELECT'),
  0, 'GR9: nenhuma policy de escrita');
SELECT is(
  (SELECT row(default_value, is_admin_only)::text FROM public.feature_permissions WHERE key = 'leads.edit_document'),
  '(f,f)', 'GR10: leads.edit_document semeada no catálogo, default false, não admin-only');

-- ===========================================================================
-- (ED) A RPC, como o editor (membro responsável + leads.edit_document)
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a1',
    '  ' || substr(pg_temp.doc('cnpj_a'),1,2) || '.' || substr(pg_temp.doc('cnpj_a'),3,3) || '.'
    || substr(pg_temp.doc('cnpj_a'),6,3) || '/' || substr(pg_temp.doc('cnpj_a'),9,4) || '-'
    || substr(pg_temp.doc('cnpj_a'),13,2) || ' '),
  jsonb_build_object('document', pg_temp.doc('cnpj_a'), 'erp_document', NULL,
                     'overridden', true, 'erp_writeback_status', 'nao_aplicavel'),
  'ED1: CNPJ com máscara e espaços é normalizado e gravado; sem cliente ERP = nao_aplicavel');

SELECT is(
  (SELECT row(document, document_kind, erp_document_at_set, source, erp_writeback_status, updated_by)::text
     FROM public.lead_documents WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a1'),
  row(pg_temp.doc('cnpj_a'), 'cnpj', NULL::text, 'manual', 'nao_aplicavel',
      '93027ffb-0000-4000-8000-0000000000a2'::uuid)::text,
  'ED2: a linha do override é lida pelo próprio membro (RLS de SELECT da org)');

SELECT is(
  (SELECT row(action, old_document, new_document, erp_document, actor_user_id, actor_team_member_id, origin)::text
     FROM public.lead_document_events WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a1'),
  row('set', NULL::text, pg_temp.doc('cnpj_a'), NULL::text,
      '93027ffb-0000-4000-8000-0000000000a2'::uuid, '93027ffb-0000-4000-8000-0000000001a2'::uuid, 'lead_card')::text,
  'ED3: evento set com old/new/erp/actor/membro/origem');

SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', pg_temp.dv_errado(pg_temp.doc('cnpj_b'))),
  'PT422', 'CPF/CNPJ inválido.', 'ED4: DV inválido é recusado com PT422');
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', '00.000.000/0000-00'),
  'PT422', 'CPF/CNPJ inválido.', 'ED5: placeholder de zeros é recusado');
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', 'abc'),
  'PT422', 'CPF/CNPJ inválido.', 'ED6: texto sem dígito não vira clear silencioso');

SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a4', pg_temp.doc('cnpj_a')),
  'PT409', 'Este documento já está em outro cliente da organização.',
  'ED7: documento já em override de OUTRO lead da org é recusado');
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a4', pg_temp.doc('erp_3')),
  'PT409', 'Este documento já está em outro cliente da organização.',
  'ED8: documento do ERP de OUTRO lead da org é recusado (não cruza casamento)');

SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a2', pg_temp.doc('erp_2')),
  jsonb_build_object('document', pg_temp.doc('erp_2'), 'erp_document', pg_temp.doc('erp_2'),
                     'overridden', false, 'erp_writeback_status', NULL),
  'ED9: digitar o próprio documento do ERP não cria override');
SELECT is(
  (SELECT count(*)::int FROM public.lead_documents WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a2'),
  0, 'ED10: e nenhuma linha nem evento redundante');

SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a2', pg_temp.doc('cnpj_b')) ->> 'erp_writeback_status',
  'pendente', 'ED11: lead com cliente ERP e override diferente = pendente');
SELECT is(
  (SELECT erp_document_at_set FROM public.lead_documents WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a2'),
  pg_temp.doc('erp_2'), 'ED12: o valor do ERP no momento da edição fica preservado');

SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a2', '   ') ->> 'overridden',
  'false', 'ED13: vazio = clear, volta a valer o ERP');
SELECT is(
  (SELECT count(*)::int FROM public.lead_documents WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a2'),
  0, 'ED14: clear apaga o override');
SELECT is(
  (SELECT row(action, old_document, new_document, erp_document)::text
     FROM public.lead_document_events
    WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a2'
    ORDER BY created_at DESC, action ASC LIMIT 1),
  row('clear', pg_temp.doc('cnpj_b'), NULL::text, pg_temp.doc('erp_2'))::text,
  'ED15: clear registra o valor anterior e o do ERP');

SELECT lives_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a2', pg_temp.doc('cnpj_b')),
  'ED16: override de novo');
SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a2', pg_temp.doc('erp_2')) ->> 'overridden',
  'false', 'ED17: digitar o documento do ERP por cima de um override = clear');
SELECT is(
  (SELECT count(*)::int FROM public.lead_document_events WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a2'),
  4, 'ED18: set, clear, set, clear: quatro eventos, nenhum para a tentativa redundante');

-- ===========================================================================
-- (SY) A RPC nunca toca o espelho do ERP
-- ===========================================================================
RESET role;
SELECT is(
  (SELECT string_agg(cnpj, ',' ORDER BY external_id) FROM public.upsell_clients
    WHERE organization_id = '93027ffb-0000-4000-8000-00000000000a'),
  pg_temp.doc('erp_2') || ',' || pg_temp.doc('erp_3'),
  'SY1: upsell_clients.cnpj segue igual ao ERP depois de todas as edições');
SET LOCAL role authenticated;

-- ===========================================================================
-- (PE) Permissões
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', pg_temp.doc('cpf_a')),
  '42501', 'Sem permissão para alterar o documento.',
  'PE1: membro que edita o lead mas não tem leads.edit_document é recusado');

SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', pg_temp.doc('cpf_a')),
  '42501', 'Você não pode editar este lead.',
  'PE2: membro com a permissão, mas que não edita o lead (policy de UPDATE), é recusado');

SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a1', pg_temp.doc('cpf_a')) ->> 'document',
  pg_temp.doc('cpf_a'), 'PE3: admin da org troca o documento sem precisar de override de permissão');
SELECT is(
  (SELECT row(old_document, new_document)::text FROM public.lead_document_events
    WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a1' AND new_document = pg_temp.doc('cpf_a')),
  row(pg_temp.doc('cnpj_a'), pg_temp.doc('cpf_a'))::text,
  'PE4: a troca registra o valor anterior');
SELECT is(
  (SELECT document_kind FROM public.lead_documents WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a1'),
  'cpf', 'PE5: document_kind acompanha o tamanho');

SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002a4', pg_temp.doc('cnpj_c')) ->> 'overridden',
  'true', 'PE6: master grava');
SELECT is(
  (SELECT row(origin, actor_team_member_id)::text FROM public.lead_document_events
    WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a4'),
  row('master', NULL::uuid)::text, 'PE7: e a trilha diz que foi o master, sem membro');

-- ===========================================================================
-- (XO) Outra org
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', pg_temp.doc('cnpj_b')),
  'PT404', 'Lead não encontrado.',
  'XO1: admin da org B não altera lead da org A (e não sabe que ele existe)');
SELECT is(
  (SELECT count(*)::int FROM public.lead_documents) + (SELECT count(*)::int FROM public.lead_document_events),
  0, 'XO2: admin da org B não lê override nem trilha da org A');
SELECT is(
  public.set_lead_document('93027ffb-0000-4000-8000-0000000002b1', pg_temp.doc('cnpj_c')) ->> 'overridden',
  'true', 'XO3: unicidade é POR ORG: o documento em override na org A é aceito na org B');

-- ===========================================================================
-- (AO) Escrita direta recusada; trilha append-only
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"93027ffb-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT throws_ok(
  format($q$INSERT INTO public.lead_documents (lead_id, organization_id, document, erp_writeback_status, updated_by)
            VALUES (%L, %L, %L, 'nao_aplicavel', %L)$q$,
         '93027ffb-0000-4000-8000-0000000002a3', '93027ffb-0000-4000-8000-00000000000a',
         pg_temp.doc('cnpj_b'), '93027ffb-0000-4000-8000-0000000000a1'),
  '42501', NULL, 'AO1: admin não insere direto em lead_documents');
SELECT throws_ok(
  $q$UPDATE public.lead_documents SET erp_writeback_status = 'confirmado'$q$,
  '42501', NULL, 'AO2: nem atualiza direto');
SELECT throws_ok(
  $q$DELETE FROM public.lead_documents$q$,
  '42501', NULL, 'AO3: nem apaga direto');
SELECT throws_ok(
  $q$INSERT INTO public.lead_document_events (organization_id, lead_id, action, actor_user_id, origin)
     VALUES ('93027ffb-0000-4000-8000-00000000000a', '93027ffb-0000-4000-8000-0000000002a3', 'set',
             '93027ffb-0000-4000-8000-0000000000a1', 'api')$q$,
  '42501', NULL, 'AO4: ninguém forja evento na trilha');
SELECT throws_ok(
  $q$DELETE FROM public.lead_document_events$q$,
  '42501', NULL, 'AO5: nem apaga a trilha');

SET LOCAL role anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  format('SELECT public.set_lead_document(%L, %L)', '93027ffb-0000-4000-8000-0000000002a1', pg_temp.doc('cnpj_b')),
  '42501', NULL, 'AO6: anon não executa a RPC');

RESET role;
SELECT throws_ok(
  $q$UPDATE public.lead_document_events SET new_document = NULL
      WHERE lead_id = '93027ffb-0000-4000-8000-0000000002a1'$q$,
  '42501', 'A trilha de documentos do lead não pode ser alterada.',
  'AO7: nem o dono do banco reescreve a trilha (trigger)');

-- ===========================================================================
-- (DR) can_update_lead == policy de UPDATE de leads
--      SELECT ... FOR KEY SHARE como authenticated aplica o USING da policy
--      de UPDATE (e o de SELECT). Nenhuma persona aqui é gestor, então os dois
--      lados têm de bater em todo par persona × lead.
-- ===========================================================================
CREATE FUNCTION pg_temp.probe_policy(p_lead uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.leads WHERE id = p_lead FOR KEY SHARE;
  RETURN FOUND;
END $$;

CREATE TEMP TABLE t_drift (persona uuid, lead uuid, pela_policy boolean, pela_funcao boolean);
GRANT INSERT, SELECT ON t_drift TO authenticated;

DO $$
DECLARE
  v_persona uuid;
  v_lead uuid;
  v_policy boolean;
BEGIN
  FOREACH v_persona IN ARRAY ARRAY[
    '93027ffb-0000-4000-8000-0000000000a1', '93027ffb-0000-4000-8000-0000000000a2',
    '93027ffb-0000-4000-8000-0000000000a3', '93027ffb-0000-4000-8000-0000000000a4',
    '93027ffb-0000-4000-8000-0000000000b1']::uuid[]
  LOOP
    FOREACH v_lead IN ARRAY ARRAY[
      '93027ffb-0000-4000-8000-0000000002a1', '93027ffb-0000-4000-8000-0000000002a2',
      '93027ffb-0000-4000-8000-0000000002a3', '93027ffb-0000-4000-8000-0000000002a4',
      '93027ffb-0000-4000-8000-0000000002b1']::uuid[]
    LOOP
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_persona, 'role', 'authenticated')::text, true);
      SET LOCAL role authenticated;
      v_policy := pg_temp.probe_policy(v_lead);
      RESET role;
      INSERT INTO t_drift VALUES (v_persona, v_lead, v_policy, public.can_update_lead(v_lead));
    END LOOP;
  END LOOP;
END $$;

SELECT is(
  (SELECT count(*)::int FROM t_drift WHERE pela_policy IS DISTINCT FROM pela_funcao),
  0, 'DR1: can_update_lead concorda com a policy de UPDATE em todos os 25 pares');
SELECT ok(
  (SELECT bool_or(pela_policy) AND bool_or(NOT pela_policy) FROM t_drift),
  'DR2: e o conjunto tem pares liberados E recusados (o teste não é vácuo)');

SELECT * FROM finish();
ROLLBACK;

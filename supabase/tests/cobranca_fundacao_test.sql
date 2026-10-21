-- supabase/tests/cobranca_fundacao_test.sql
--
-- Cobrança · entrega 1 (migration 20271212000000_cobranca_fundacao.sql).
--
--   (GR) grants: leitura por RLS, escrita só por RPC, anon sem nada
--   (RL) RLS: flag + cobranca.view; org vizinha e membro sem permissão não veem
--   (PM) RPC: flag desligada, sem permissão, membro liberado, master
--   (KS) keystone: cadastra com títulos, um caso só, baixa FIFO até Recuperado
--   (IX) invariantes de modelo: um caso aberto por inadimplente, eventos append-only
--
-- A lógica detalhada (importação, desfechos, métricas) é coberta em
-- tests/integration/cobranca-fundacao.test.mjs (PGlite). Aqui o que importa é
-- o banco REAL: GRANT, RLS, has_feature_permission e assert_org_access de prod.
-- Personas: a1 admin da org A (flag ligada), a2 membro de A sem permissão,
-- a3 membro de A com cobranca.view/edit, b1 admin da org B (flag desligada),
-- c1 master.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('c0b7a000-0000-4000-8000-00000000000a', 'Org Cob A', 'org-cob-a', 'America/Sao_Paulo'),
  ('c0b7a000-0000-4000-8000-00000000000b', 'Org Cob B', 'org-cob-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"cobranca": true}'::jsonb
 WHERE id = 'c0b7a000-0000-4000-8000-00000000000a';

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
    ('c0b7a000-0000-4000-8000-0000000000a1', 'cob-admin-a@test.local'),
    ('c0b7a000-0000-4000-8000-0000000000a2', 'cob-membro-a@test.local'),
    ('c0b7a000-0000-4000-8000-0000000000a3', 'cob-cobradora-a@test.local'),
    ('c0b7a000-0000-4000-8000-0000000000b1', 'cob-admin-b@test.local'),
    ('c0b7a000-0000-4000-8000-0000000000c1', 'cob-master@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('c0b7a000-0000-4000-8000-0000000001a1', 'c0b7a000-0000-4000-8000-00000000000a', 'c0b7a000-0000-4000-8000-0000000000a1', 'Admin A',     'admin',  true),
  ('c0b7a000-0000-4000-8000-0000000001a2', 'c0b7a000-0000-4000-8000-00000000000a', 'c0b7a000-0000-4000-8000-0000000000a2', 'Membro A',    'member', true),
  ('c0b7a000-0000-4000-8000-0000000001a3', 'c0b7a000-0000-4000-8000-00000000000a', 'c0b7a000-0000-4000-8000-0000000000a3', 'Cobradora A', 'member', true),
  ('c0b7a000-0000-4000-8000-0000000001b1', 'c0b7a000-0000-4000-8000-00000000000b', 'c0b7a000-0000-4000-8000-0000000000b1', 'Admin B',     'admin',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('c0b7a000-0000-4000-8000-0000000000c1', true);

INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('c0b7a000-0000-4000-8000-0000000001a3', 'c0b7a000-0000-4000-8000-00000000000a', 'cobranca.view', true),
  ('c0b7a000-0000-4000-8000-0000000001a3', 'c0b7a000-0000-4000-8000-00000000000a', 'cobranca.edit', true);

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(bool_and(has_table_privilege('authenticated', 'public.' || t, 'SELECT')
              AND NOT has_table_privilege('authenticated', 'public.' || t, 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.' || t, 'DELETE')
              AND NOT has_table_privilege('anon', 'public.' || t, 'SELECT')),
  'GR1: authenticated só lê as 8 tabelas e as 2 views; anon nada')
  FROM unnest(ARRAY['cobranca_etapas', 'cobranca_inadimplentes', 'cobranca_titulos', 'cobranca_casos',
                    'cobranca_compromissos', 'cobranca_compromisso_parcelas', 'cobranca_pagamentos',
                    'cobranca_eventos', 'cobranca_titulos_saldo', 'cobranca_inadimplentes_resumo']) AS t;

SELECT ok(bool_and(c.relrowsecurity), 'GR2: RLS ligada nas 8 tabelas')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'cobranca\_%';

SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'cobranca\_%'
             AND (qual = 'true' OR with_check = 'true')), 0,
  'GR3: nenhuma policy aberta (true)');

SELECT ok(NOT has_function_privilege('anon', 'public.cobranca_importar(uuid, jsonb, boolean)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.cobranca_pagamento_registrar(uuid, numeric, date, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.cobranca_inadimplente_salvar(uuid, uuid, jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.cobranca_metricas(uuid, date)', 'EXECUTE'),
  'GR4: anon não executa as RPCs');
SELECT ok(has_function_privilege('authenticated', 'public.cobranca_importar(uuid, jsonb, boolean)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.cobranca_caso_mover(uuid, uuid, double precision)', 'EXECUTE'),
  'GR5: authenticated executa as RPCs');
SELECT ok(NOT has_function_privilege('authenticated', 'private.cobranca_exigir(uuid, text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'private.cobranca_garantir_caso(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'private.cobranca_encerrar_caso(uuid, text)', 'EXECUTE'),
  'GR6: internos fechados para authenticated');
SELECT ok(bool_and(p.prosecdef AND p.proconfig IS NOT NULL), 'GR7: RPCs de escrita são DEFINER com search_path fixo')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'cobranca\_%' AND p.proname <> 'cobranca_metricas';

-- ===========================================================================
-- (PM) RPC: flag, permissão, master
-- ===========================================================================
SET LOCAL role authenticated;

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000b1');
SELECT throws_ok(
  $$ SELECT public.cobranca_inadimplente_salvar('c0b7a000-0000-4000-8000-00000000000b', NULL, '{"nome":"X"}') $$,
  '42501', 'A área de cobrança não está liberada para esta organização.',
  'PM1: org sem a flag recusa');
SELECT throws_ok(
  $$ SELECT public.cobranca_inadimplente_salvar('c0b7a000-0000-4000-8000-00000000000a', NULL, '{"nome":"X"}') $$,
  '42501', NULL, 'PM2: admin de outra org não escreve na org A');

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000a2');
SELECT throws_ok(
  $$ SELECT public.cobranca_inadimplente_salvar('c0b7a000-0000-4000-8000-00000000000a', NULL, '{"nome":"X"}') $$,
  '42501', 'Você não tem permissão para operar a cobrança.',
  'PM3: membro sem cobranca.edit recusa (setor separado)');

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000a3');
SELECT lives_ok(
  $$ SELECT public.cobranca_inadimplente_salvar('c0b7a000-0000-4000-8000-00000000000a', NULL,
       '{"nome":"Padaria Teste","documento":"08.771.245/0001-63",
         "titulos":[{"numero":"B","valor":300,"vencimento":"2026-10-10"},
                    {"numero":"A","valor":500,"vencimento":"2026-09-30"}]}') $$,
  'PM4: membro liberado cadastra com títulos');

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000c1');
SELECT lives_ok(
  $$ SELECT public.cobranca_inadimplente_salvar('c0b7a000-0000-4000-8000-00000000000a', NULL,
       '{"nome":"Cliente do master","telefone":"48999990001"}') $$,
  'PM5: master opera a org com a flag (TorqueCRM não tem membros)');

-- ===========================================================================
-- (RL) leitura pela RLS
-- ===========================================================================
SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000a2');
SELECT is((SELECT count(*)::int FROM public.cobranca_inadimplentes), 0, 'RL1: membro sem cobranca.view não vê');
SELECT is((SELECT count(*)::int FROM public.cobranca_inadimplentes_resumo), 0, 'RL2: nem pela view');

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000b1');
SELECT is((SELECT count(*)::int FROM public.cobranca_inadimplentes), 0, 'RL3: org vizinha não vê');
SELECT is((SELECT count(*)::int FROM public.cobranca_etapas), 0, 'RL4: nem as etapas');

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000a1');
SELECT is((SELECT count(*)::int FROM public.cobranca_inadimplentes_resumo), 2, 'RL5: admin da org A vê os dois');
SELECT is((SELECT count(*)::int FROM public.cobranca_etapas), 9, 'RL6: e as 9 etapas semeadas');

SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000c1');
SELECT ok((SELECT count(*) FROM public.cobranca_inadimplentes
            WHERE organization_id = 'c0b7a000-0000-4000-8000-00000000000a') = 2,
  'RL7: master vê a org com a flag');

-- ===========================================================================
-- (KS) keystone: um caso, baixa FIFO, Recuperado
-- ===========================================================================
SELECT pg_temp.as_user('c0b7a000-0000-4000-8000-0000000000a3');

SELECT is((SELECT count(*)::int FROM public.cobranca_casos c
            JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
           WHERE i.documento = '08771245000163'), 1, 'KS1: dois títulos, um caso');
SELECT is((SELECT etapa_nome FROM public.cobranca_inadimplentes_resumo WHERE documento = '08771245000163'),
  'Vencido', 'KS2: caso nasce na primeira etapa aberta');

SELECT lives_ok(
  $$ SELECT public.cobranca_pagamento_registrar(
       (SELECT caso_id FROM public.cobranca_inadimplentes_resumo WHERE documento = '08771245000163'),
       600, CURRENT_DATE) $$,
  'KS3: pagamento parcial');
SELECT is((SELECT status FROM public.cobranca_titulos WHERE numero = 'A'), 'pago', 'KS4: FIFO quita o mais antigo');
SELECT is((SELECT saldo FROM public.cobranca_titulos_saldo WHERE numero = 'B'), 200.00::numeric(14, 2), 'KS5: e abate o resto do seguinte');

SELECT is((SELECT (public.cobranca_pagamento_registrar(
             (SELECT caso_id FROM public.cobranca_inadimplentes_resumo WHERE documento = '08771245000163'),
             200, CURRENT_DATE)) ->> 'quitado'), 'true', 'KS6: quita o saldo');
SELECT is((SELECT c.desfecho FROM public.cobranca_casos c
            JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
           WHERE i.documento = '08771245000163'), 'recuperado', 'KS7: caso fecha em Recuperado');

-- ===========================================================================
-- (IX) invariantes de modelo
-- ===========================================================================
SET LOCAL role postgres;

SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cobranca_casos_um_aberto_por_inadimplente'
                     AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%encerrado_em IS NULL%'),
  'IX1: um caso aberto por inadimplente (índice único parcial)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cobranca_eventos', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.cobranca_eventos', 'DELETE'),
  'IX2: histórico append-only para o cliente');
SELECT is((SELECT default_value FROM public.feature_permissions WHERE key = 'cobranca.view'), false,
  'IX3: cobranca.view nasce desligada para membro');

SELECT * FROM finish();

ROLLBACK;

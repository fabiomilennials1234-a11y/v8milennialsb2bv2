-- supabase/tests/agenda_busca_global_test.sql
--
-- Busca global da Agenda (migration 20271216000000_agenda_busca_global.sql).
--
--   (FO) agenda_search_fold: sem acento, sem caixa; NULL -> NULL.
--   (GR) GRANTs: anon e PUBLIC sem EXECUTE; authenticated com. Provado por
--        pg_proc.proacl (fonte da verdade) E por chamada real como anon.
--   (AD) admin da org: acha tudo, SEM janela de datas (800 dias atrás e 400 à
--        frente), por título, nome, empresa e código ERP; ordem = futuros
--        primeiro (mais próximo antes), depois passados do mais recente.
--   (ME) membro sem `agenda.view_all`: só o que é seu + sem dono + convidado.
--        O compromisso de OUTRO membro não aparece (follow-up, reunião e
--        mensagem agendada) — os dois espaços de id (auth.users.id das
--        reuniões, team_members.id das outras duas fontes) são exercitados.
--   (TX) o termo: acento, caixa, curingas escapados (% e _), mínimo 2 chars,
--        NULL, limite duro.
--   (XO) outra org não vaza: nem pelo gate (42501) nem pelo conteúdo.
--   (FT) filtros herdados da base: mensagem cancelada e follow-up arquivado
--        ficam de fora.
--
-- Roda inteiro em transação revertida. Fixtures: UUIDs com prefixo a9e3da00.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('a9e3da00-0000-4000-8000-00000000000a', 'Org AGB A', 'org-agb-a', 'America/Sao_Paulo'),
  ('a9e3da00-0000-4000-8000-00000000000b', 'Org AGB B', 'org-agb-b', 'America/Sao_Paulo')
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
    ('a9e3da00-0000-4000-8000-0000000000a1', 'agb-admin@test.local'),
    ('a9e3da00-0000-4000-8000-0000000000a2', 'agb-membro-a@test.local'),
    ('a9e3da00-0000-4000-8000-0000000000a3', 'agb-membro-b@test.local'),
    ('a9e3da00-0000-4000-8000-0000000000b1', 'agb-org-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('a9e3da00-0000-4000-8000-0000000001a1', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000000a1', 'Admin A',   'admin',  true),
  ('a9e3da00-0000-4000-8000-0000000001a2', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000000a2', 'Membro A',  'member', true),
  ('a9e3da00-0000-4000-8000-0000000001a3', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000000a3', 'Membro B',  'member', true),
  ('a9e3da00-0000-4000-8000-0000000001b1', 'a9e3da00-0000-4000-8000-00000000000b', 'a9e3da00-0000-4000-8000-0000000000b1', 'Admin B',   'admin',  true)
ON CONFLICT (id) DO NOTHING;

-- Membro A e Membro B têm a agenda recortada ("só os meus").
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('a9e3da00-0000-4000-8000-0000000001a2', 'a9e3da00-0000-4000-8000-00000000000a', 'agenda.view_all', false),
  ('a9e3da00-0000-4000-8000-0000000001a3', 'a9e3da00-0000-4000-8000-00000000000a', 'agenda.view_all', false);

INSERT INTO public.leads (id, organization_id, name, company, erp_code, origin, created_at) VALUES
  ('a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-00000000000a', 'Padaria Estrela Ltda', 'Estrela Paes SA', 'CLI-0042', 'meta_ads', now()),
  ('a9e3da00-0000-4000-8000-0000000002a2', 'a9e3da00-0000-4000-8000-00000000000a', 'Café Açaí',            'Zeta Alimentos',  NULL,       'meta_ads', now()),
  ('a9e3da00-0000-4000-8000-0000000002b1', 'a9e3da00-0000-4000-8000-00000000000b', 'Padaria Estrela Beta', 'Beta Org B',      'CLI-0042', 'meta_ads', now())
ON CONFLICT (id) DO NOTHING;

-- Reuniões do lead L1 (todas casam "estrela" pelo NOME DO LEAD, não pelo título).
-- created_by = auth.users.id (espaço das reuniões).
INSERT INTO public.meetings (id, organization_id, title, start_at, end_at, lead_id, created_by, event_type) VALUES
  -- de Membro B, 400 dias à frente (fora de qualquer janela de tela)
  ('a9e3da00-0000-4000-8000-0000000003f1', 'a9e3da00-0000-4000-8000-00000000000a', 'Renovação anual',  now() + interval '400 days', now() + interval '400 days 1 hour', 'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000000a3', 'meeting'),
  -- de Membro B, 800 dias atrás
  ('a9e3da00-0000-4000-8000-0000000003f2', 'a9e3da00-0000-4000-8000-00000000000a', 'Primeira visita',  now() - interval '800 days', now() - interval '800 days' + interval '1 hour', 'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000000a3', 'meeting'),
  -- de Membro A
  ('a9e3da00-0000-4000-8000-0000000003f3', 'a9e3da00-0000-4000-8000-00000000000a', 'Alinhamento',      now() - interval '10 days',  now() - interval '10 days' + interval '1 hour',  'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000000a2', 'meeting'),
  -- sem dono
  ('a9e3da00-0000-4000-8000-0000000003f4', 'a9e3da00-0000-4000-8000-00000000000a', 'Reunião órfã',    now() - interval '20 days',  now() - interval '20 days' + interval '1 hour',  'a9e3da00-0000-4000-8000-0000000002a1', NULL, 'meeting'),
  -- de Membro B, com Membro A convidado
  ('a9e3da00-0000-4000-8000-0000000003f5', 'a9e3da00-0000-4000-8000-00000000000a', 'Workshop',        now() - interval '40 days',  now() - interval '40 days' + interval '1 hour',  'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000000a3', 'meeting'),
  -- lead L2 (acento), de Membro B
  ('a9e3da00-0000-4000-8000-0000000003f6', 'a9e3da00-0000-4000-8000-00000000000a', 'Degustação',      now() + interval '3 days',   now() + interval '3 days 1 hour',                 'a9e3da00-0000-4000-8000-0000000002a2', 'a9e3da00-0000-4000-8000-0000000000a3', 'meeting'),
  -- título com curingas literais, sem lead
  ('a9e3da00-0000-4000-8000-0000000003f7', 'a9e3da00-0000-4000-8000-00000000000a', 'Desconto 50% fixo_ok', now() + interval '2 days', now() + interval '2 days 1 hour',             NULL, 'a9e3da00-0000-4000-8000-0000000000a1', 'meeting'),
  -- org B
  ('a9e3da00-0000-4000-8000-0000000003b1', 'a9e3da00-0000-4000-8000-00000000000b', 'Visita Org B',    now() + interval '1 day',    now() + interval '1 day 1 hour',                  'a9e3da00-0000-4000-8000-0000000002b1', 'a9e3da00-0000-4000-8000-0000000000b1', 'meeting')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meeting_participants (meeting_id, team_member_id) VALUES
  ('a9e3da00-0000-4000-8000-0000000003f5', 'a9e3da00-0000-4000-8000-0000000001a2');

-- follow_ups: assigned_to = team_members.id (OUTRO espaço de id).
INSERT INTO public.follow_ups (id, organization_id, lead_id, assigned_to, title, due_date, archived_at) VALUES
  ('a9e3da00-0000-4000-8000-0000000004a1', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000001a3', 'Ligar de volta',    now() - interval '30 days', NULL),
  ('a9e3da00-0000-4000-8000-0000000004a2', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000001a2', 'Enviar proposta',   now() - interval '25 days', NULL),
  -- arquivado: fica de fora para todos
  ('a9e3da00-0000-4000-8000-0000000004a3', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000002a1', 'a9e3da00-0000-4000-8000-0000000001a2', 'Follow-up arquivado', now() - interval '50 days', now());

-- scheduled_user_messages: created_by = team_members.id.
INSERT INTO public.scheduled_user_messages (id, organization_id, lead_id, phone_number, created_by, message_content, scheduled_at, status) VALUES
  ('a9e3da00-0000-4000-8000-0000000005a1', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000002a1', '5511999990001', 'a9e3da00-0000-4000-8000-0000000001a3', 'Olá, tudo bem?', now() + interval '5 days', 'scheduled'),
  -- cancelada: fica de fora
  ('a9e3da00-0000-4000-8000-0000000005a2', 'a9e3da00-0000-4000-8000-00000000000a', 'a9e3da00-0000-4000-8000-0000000002a1', '5511999990001', 'a9e3da00-0000-4000-8000-0000000001a3', 'Mensagem cancelada', now() + interval '6 days', 'cancelled');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (FO) O normalizador
-- ===========================================================================
SELECT is(public.agenda_search_fold('Café Açaí ÃÕ Ü'), 'cafe acai ao u', 'FO1: tira acento e caixa');
SELECT is(public.agenda_search_fold(NULL), NULL::text, 'FO2: NULL -> NULL');

-- ===========================================================================
-- (GR) GRANTs
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'public.search_agenda_events(uuid,text,integer)'::regprocedure
      AND a.grantee IN ('anon'::regrole, 0::oid)),
  0, 'GR1: anon e PUBLIC sem EXECUTE em search_agenda_events (proacl)');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'public.agenda_search_fold(text)'::regprocedure
      AND a.grantee IN ('anon'::regrole, 0::oid)),
  0, 'GR2: anon e PUBLIC sem EXECUTE em agenda_search_fold (proacl)');
SELECT ok(has_function_privilege('authenticated', 'public.search_agenda_events(uuid,text,integer)', 'EXECUTE'),
  'GR3: authenticated executa search_agenda_events');
SELECT ok(NOT has_function_privilege('anon', 'public.search_agenda_events(uuid,text,integer)', 'EXECUTE'),
  'GR4: anon não executa search_agenda_events (has_function_privilege)');
SELECT ok(
  (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.search_agenda_events(uuid,text,integer)'::regprocedure),
  'GR5: SECURITY INVOKER (o RLS por organização continua valendo)');

-- Chamada real como anon: permission denied (42501).
SET LOCAL role anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela')$$,
  '42501', NULL, 'GR6: anon chamando a RPC leva permission denied');
SET LOCAL role postgres;

-- ===========================================================================
-- (AD) Admin da org A
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a9e3da00-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- Todos casam por NOME do lead "Padaria Estrela": 5 reuniões + 2 follow-ups
-- (o arquivado fora) + 1 mensagem (a cancelada fora) = 8.
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela')),
  8, 'AD1: admin acha os 8 compromissos do cliente, em qualquer data');

SELECT is(
  (SELECT array_agg(e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela') e),
  ARRAY[
    'a9e3da00-0000-4000-8000-0000000005a1',  -- mensagem  +5d  (futuro mais próximo)
    'a9e3da00-0000-4000-8000-0000000003f1',  -- reunião  +400d
    'a9e3da00-0000-4000-8000-0000000003f3',  -- reunião   -10d (passado mais recente)
    'a9e3da00-0000-4000-8000-0000000003f4',  -- reunião   -20d
    'a9e3da00-0000-4000-8000-0000000004a2',  -- follow-up -25d
    'a9e3da00-0000-4000-8000-0000000004a1',  -- follow-up -30d
    'a9e3da00-0000-4000-8000-0000000003f5',  -- reunião   -40d
    'a9e3da00-0000-4000-8000-0000000003f2'   -- reunião  -800d
  ]::uuid[],
  'AD2: futuros primeiro (mais próximo antes), depois passados do mais recente');

SELECT ok(
  EXISTS (SELECT 1 FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela')
           WHERE id = 'a9e3da00-0000-4000-8000-0000000003f2')
  AND EXISTS (SELECT 1 FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela')
           WHERE id = 'a9e3da00-0000-4000-8000-0000000003f1'),
  'AD3: acha compromisso a 800 dias atrás e a 400 dias à frente (sem janela)');

SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'paes')),
  8, 'AD4: acha pela EMPRESA do lead ("Estrela Paes SA"), sem acento no termo');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'PÃES')),
  8, 'AD5: termo com acento e caixa alta casa do mesmo jeito');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'cli-0042')),
  8, 'AD6: acha pelo CÓDIGO ERP do lead (e o da org B, mesmo código, não entra)');
SELECT is(
  (SELECT array_agg(e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'renovacao') e),
  ARRAY['a9e3da00-0000-4000-8000-0000000003f1']::uuid[],
  'AD7: acha pelo TÍTULO da reunião ("Renovação anual" por "renovacao")');
SELECT is(
  (SELECT array_agg(e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'acai') e),
  ARRAY['a9e3da00-0000-4000-8000-0000000003f6']::uuid[],
  'AD8: "acai" acha o lead "Café Açaí"');
SELECT is(
  (SELECT row(lead_name, lead_company, source, owner_team_member_id)::text
     FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'degustacao')),
  row('Café Açaí'::text, 'Zeta Alimentos'::text, 'meeting'::text,
      'a9e3da00-0000-4000-8000-0000000001a3'::uuid)::text,
  'AD9: o dono da reunião volta normalizado para team_members.id (não auth.users.id)');

-- ===========================================================================
-- (TX) O termo
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'e')),
  0, 'TX1: 1 caractere devolve vazio (e não erro)');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', NULL)),
  0, 'TX2: termo NULL devolve vazio');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', '   ')),
  0, 'TX3: só espaços devolve vazio');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', '%%')),
  0, 'TX4: "%%" é texto literal, não curinga (senão devolveria a agenda inteira)');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', '__')),
  0, 'TX5: "__" é texto literal, não curinga');
SELECT is(
  (SELECT array_agg(e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', '50%') e),
  ARRAY['a9e3da00-0000-4000-8000-0000000003f7']::uuid[],
  'TX6: "50%" acha o título que tem "50%" literal');
SELECT is(
  (SELECT array_agg(e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'fixo_ok') e),
  ARRAY['a9e3da00-0000-4000-8000-0000000003f7']::uuid[],
  'TX7: "_" literal casa o sublinhado, e só ele');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'fixoXok')),
  0, 'TX8: "fixoXok" não casa "fixo_ok" ("_" não é curinga)');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela', 3)),
  3, 'TX9: p_limit respeitado');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela', 0)),
  1, 'TX10: p_limit 0 vira 1 (limite duro inferior)');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela', 100000)),
  8, 'TX11: p_limit absurdo é tampado em 100 (aqui só existem 8)');

-- ===========================================================================
-- (FT) Filtros herdados da base
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'cancelada')),
  0, 'FT1: mensagem cancelada fica de fora');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'arquivado')),
  0, 'FT2: follow-up arquivado fica de fora');

-- ===========================================================================
-- (ME) Membro A: agenda recortada
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a9e3da00-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

-- Vê: a sua (f3), a sem dono (f4), onde foi convidado (f5), o follow-up seu (4a2).
SELECT is(
  (SELECT array_agg(e.id ORDER BY e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela') e),
  (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
    'a9e3da00-0000-4000-8000-0000000003f3',
    'a9e3da00-0000-4000-8000-0000000003f4',
    'a9e3da00-0000-4000-8000-0000000003f5',
    'a9e3da00-0000-4000-8000-0000000004a2'
  ]::uuid[]) x),
  'ME1: membro sem view_all vê o seu + sem dono + convidado, e só');

SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela') e
    WHERE e.id IN ('a9e3da00-0000-4000-8000-0000000003f1',   -- reunião de outro
                   'a9e3da00-0000-4000-8000-0000000003f2',   -- reunião de outro
                   'a9e3da00-0000-4000-8000-0000000004a1',   -- follow-up de outro
                   'a9e3da00-0000-4000-8000-0000000005a1')), -- mensagem de outro
  0, 'ME2: NÃO vê reunião, follow-up nem mensagem agendada de outro membro');

SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'renovacao')),
  0, 'ME3: buscar pelo título de um compromisso alheio não revela nada');

-- Membro B (dono dos compromissos alheios) vê os dele.
SELECT set_config('request.jwt.claims',
  '{"sub":"a9e3da00-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(e.id ORDER BY e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela') e),
  (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
    'a9e3da00-0000-4000-8000-0000000003f1',
    'a9e3da00-0000-4000-8000-0000000003f2',
    'a9e3da00-0000-4000-8000-0000000003f4',
    'a9e3da00-0000-4000-8000-0000000003f5',
    'a9e3da00-0000-4000-8000-0000000004a1',
    'a9e3da00-0000-4000-8000-0000000005a1'
  ]::uuid[]) x),
  'ME4: o dono vê os seus (reunião por auth.users.id, follow-up e mensagem por team_members.id) + sem dono');

-- ===========================================================================
-- (XO) Outra org
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"a9e3da00-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT * FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'estrela')$$,
  '42501', 'forbidden: org not accessible',
  'XO1: admin da org B não busca na org A (gate de org)');

SELECT is(
  (SELECT array_agg(e.id) FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000b', 'estrela') e),
  ARRAY['a9e3da00-0000-4000-8000-0000000003b1']::uuid[],
  'XO2: na própria org B só aparece o que é da org B (mesmo código ERP, outro tenant)');

SELECT set_config('request.jwt.claims',
  '{"sub":"a9e3da00-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT * FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000b', 'estrela')$$,
  '42501', 'forbidden: org not accessible',
  'XO3: admin da org A não busca na org B');
SELECT throws_ok(
  $$SELECT * FROM public.search_agenda_events(NULL, 'estrela')$$,
  '42501', 'forbidden: org not accessible',
  'XO4: org NULL é recusada');
SELECT is(
  (SELECT count(*)::int FROM public.search_agenda_events('a9e3da00-0000-4000-8000-00000000000a', 'Org B')),
  0, 'XO5: a org A não enxerga título nem lead da org B pelo conteúdo');

SELECT * FROM finish();

ROLLBACK;

-- supabase/tests/agenda_de_contatos_test.sql
--
-- Agenda de contatos do Comando (migration 20280110000000_agenda_de_contatos.sql).
--
--   (MC) marcar e remarcar: uma agenda ativa por (cliente, dono).
--   (SI) situação pela data no fuso da org: atrasada / hoje / futura.
--   (ES) escopo: membro vê só as suas; admin vê a equipe; "só as minhas".
--   (PE) permissão: membro não marca para outro; admin marca; lead de outra org não.
--   (X)  o X fecha; fechar de novo e fechar a de outro = não encontrada; desfazer.
--   (RS) resumo por cor e por dia.
--   (SG) outra org recusada; imutáveis; INVOKER; anon sem EXECUTE.
--
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(31);

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('a6e0d000-0000-4000-8000-00000000000a', 'Org AG A', 'org-ag-a', 'America/Sao_Paulo', '{}'::jsonb),
  ('a6e0d000-0000-4000-8000-00000000000b', 'Org AG B', 'org-ag-b', 'America/Sao_Paulo', '{}'::jsonb)
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
    ('a6e0d000-0000-4000-8000-0000000000a1', 'ag-admin-a@test.local'),
    ('a6e0d000-0000-4000-8000-0000000000a2', 'ag-vend2-a@test.local'),
    ('a6e0d000-0000-4000-8000-0000000000a3', 'ag-vend3-a@test.local'),
    ('a6e0d000-0000-4000-8000-0000000000b1', 'ag-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('a6e0d000-0000-4000-8000-0000000001a1', 'a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000000a1', 'Admin AG A', 'admin',  true),
  ('a6e0d000-0000-4000-8000-0000000001a2', 'a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000000a2', 'Vend 2',     'member', true),
  ('a6e0d000-0000-4000-8000-0000000001a3', 'a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000000a3', 'Vend 3',     'member', true),
  ('a6e0d000-0000-4000-8000-0000000001b1', 'a6e0d000-0000-4000-8000-00000000000b', 'a6e0d000-0000-4000-8000-0000000000b1', 'Admin AG B', 'admin',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, company, phone, erp_code, origin) VALUES
  ('a6e0d000-0000-4000-8000-0000000002a1', 'a6e0d000-0000-4000-8000-00000000000a', 'Alfa Bar',   'Alfa LTDA', '5548999990001', '7001', 'meta_ads'),
  ('a6e0d000-0000-4000-8000-0000000002a2', 'a6e0d000-0000-4000-8000-00000000000a', 'Beta Loja',  'Beta SA',   '5548999990002', '7002', 'meta_ads'),
  ('a6e0d000-0000-4000-8000-0000000002a3', 'a6e0d000-0000-4000-8000-00000000000a', 'Gama Café',  NULL,        '5548999990003', NULL,   'meta_ads'),
  ('a6e0d000-0000-4000-8000-0000000002b1', 'a6e0d000-0000-4000-8000-00000000000b', 'Lead da B',  NULL,        '5548999990009', NULL,   'meta_ads');

-- Beta tem cadastro do ERP (cidade, representante) e dois telefones; Gama não
-- tem nada disso e cai no telefone do lead.
INSERT INTO public.upsell_clients (organization_id, lead_id, name, erp_city, erp_uf, erp_owner_name) VALUES
  ('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a2', 'Beta Loja', 'FLORIANOPOLIS', 'SC', 'FERNANDA LESSIR MACHADO');
INSERT INTO public.lead_phones (organization_id, lead_id, phone, is_primary, source, created_at) VALUES
  ('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a2', '5548999990002', true,  'erp', now() - interval '2 days'),
  ('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a2', '554833330002',  false, 'erp', now() - interval '1 day');

SET LOCAL session_replication_role = origin;

-- Atalhos de persona (o JWT decide quem é "eu").
CREATE FUNCTION pg_temp.como(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SELECT NULL::void
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como(text) TO authenticated;

SET LOCAL role authenticated;

-- ===========================================================================
-- Vend 2 (membro)
-- ===========================================================================
SELECT pg_temp.como('a6e0d000-0000-4000-8000-0000000000a2');

SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a1', public.agenda_contatos_hoje('a6e0d000-0000-4000-8000-00000000000a') + 3)$$,
  'MC: membro marca agenda para si');

SELECT is(
  (SELECT count(*)::int FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')),
  1, 'MC: aparece na lista dele');

SELECT is(
  (SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a1', public.agenda_contatos_hoje('a6e0d000-0000-4000-8000-00000000000a') + 5)),
  (SELECT id FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') LIMIT 1),
  'MC: marcar o mesmo cliente de novo devolve a MESMA agenda');

SELECT is(
  (SELECT (count(*), max(data_agenda) - public.agenda_contatos_hoje('a6e0d000-0000-4000-8000-00000000000a'))::text FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')),
  '(1,5)', 'MC: remarcar troca a data, não cria uma segunda');

SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a2', public.agenda_contatos_hoje('a6e0d000-0000-4000-8000-00000000000a'), 'Ligar depois do almoço')$$,
  'MC: agenda para hoje, com observação');
SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a3', public.agenda_contatos_hoje('a6e0d000-0000-4000-8000-00000000000a') - 2)$$,
  'MC: agenda com data passada');

-- (SI) situação e ordem: atrasada, hoje, futura
SELECT is(
  (SELECT string_agg(lead_name || ':' || situacao, ' | ' ORDER BY data_agenda) FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')),
  'Gama Café:atrasada | Beta Loja:hoje | Alfa Bar:futura',
  'SI: vermelho atrasada, amarelo hoje, azul futura');
SELECT is(
  (SELECT string_agg(lead_name, ' | ') FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')),
  'Gama Café | Beta Loja | Alfa Bar',
  'SI: a lista vem da mais atrasada para a mais distante');
SELECT is(
  (SELECT (lead_company, lead_erp_code, lead_phones, lead_cidade, lead_uf, erp_representante, observacao, owner_name)::text FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Beta Loja'),
  '("Beta SA",7002,"{5548999990002,554833330002}",FLORIANOPOLIS,SC,"FERNANDA LESSIR MACHADO","Ligar depois do almoço","Vend 2")',
  'SI: traz os dados da planilha — nome fantasia, código, telefones (principal primeiro), cidade, representante do ERP, dono');
SELECT is(
  (SELECT (lead_phones, lead_cidade, erp_representante)::text FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Gama Café'),
  '({5548999990003},,)',
  'SI: sem cadastro do ERP, telefone do lead e cidade/representante vazios');

-- (RS) resumo
SELECT set_eq(
  $$SELECT situacao, total FROM public.get_agenda_contatos_resumo('a6e0d000-0000-4000-8000-00000000000a')$$,
  $$VALUES ('atrasada'::text, 1::bigint), ('hoje'::text, 1::bigint), ('futura'::text, 1::bigint)$$,
  'RS: um de cada cor');
SELECT is(
  (SELECT dia FROM public.get_agenda_contatos_resumo('a6e0d000-0000-4000-8000-00000000000a') WHERE situacao = 'atrasada'),
  NULL::date, 'RS: atrasadas vêm numa linha só, sem dia');

-- (PE) membro não marca para outro; lead de outra org não
SELECT throws_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a1', current_date, NULL, 'a6e0d000-0000-4000-8000-0000000001a3')$$,
  '42501', NULL, 'PE: membro não marca agenda para outra pessoa');
SELECT throws_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002b1', current_date)$$,
  '42501', NULL, 'PE: lead de outra org é recusado');
SELECT throws_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a1', NULL)$$,
  '22023', NULL, 'PE: sem data é recusado');

-- ===========================================================================
-- Vend 3 (membro) não vê nem fecha a agenda do Vend 2
-- ===========================================================================
SELECT pg_temp.como('a6e0d000-0000-4000-8000-0000000000a3');

SELECT is(
  (SELECT count(*)::int FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')),
  0, 'ES: membro não vê a agenda de outro membro');
SELECT throws_ok(
  $$SELECT public.agenda_contato_concluir((SELECT a.id FROM public.agenda_contatos a LIMIT 1))$$,
  'P0002', NULL, 'X: membro não fecha a agenda de outro (não encontrada)');

-- ===========================================================================
-- Admin vê a equipe e marca para outro
-- ===========================================================================
SELECT pg_temp.como('a6e0d000-0000-4000-8000-0000000000a1');

SELECT is(
  (SELECT count(*)::int FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')),
  3, 'ES: admin vê as agendas da equipe');
SELECT is(
  (SELECT count(*)::int FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a', true)),
  0, 'ES: admin em "Minha central" vê só as dele');
SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a1', current_date + 1, NULL, 'a6e0d000-0000-4000-8000-0000000001a3')$$,
  'PE: admin marca agenda para outro membro');
SELECT is(
  (SELECT count(*)::int FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Alfa Bar'),
  2, 'MC: o mesmo cliente pode ter agenda com donos diferentes');

-- ===========================================================================
-- Vend 2: o X
-- ===========================================================================
SELECT pg_temp.como('a6e0d000-0000-4000-8000-0000000000a2');

SELECT lives_ok(
  $$SELECT public.agenda_contato_concluir((SELECT id FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Gama Café'))$$,
  'X: dono fecha a agenda atrasada');
SELECT is(
  (SELECT count(*)::int FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Gama Café'),
  0, 'X: fechada sai da lista');
SELECT throws_ok(
  $$SELECT public.agenda_contato_concluir((SELECT a.id FROM public.agenda_contatos a WHERE a.lead_id = 'a6e0d000-0000-4000-8000-0000000002a3'))$$,
  'P0002', NULL, 'X: fechar de novo diz que já foi fechada');
SELECT lives_ok(
  $$SELECT public.agenda_contato_reabrir((SELECT a.id FROM public.agenda_contatos a WHERE a.lead_id = 'a6e0d000-0000-4000-8000-0000000002a3'))$$,
  'X: desfazer reabre');
SELECT is(
  (SELECT situacao FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Gama Café'),
  'atrasada', 'X: reaberta volta como estava');

-- Fecha, marca de novo (nova agenda), e o desfazer da antiga é recusado.
SELECT public.agenda_contato_concluir((SELECT id FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a') WHERE lead_name = 'Gama Café'));
SELECT public.agenda_contato_marcar('a6e0d000-0000-4000-8000-00000000000a', 'a6e0d000-0000-4000-8000-0000000002a3', current_date + 7);
SELECT throws_ok(
  $$SELECT public.agenda_contato_reabrir((SELECT a.id FROM public.agenda_contatos a WHERE a.lead_id = 'a6e0d000-0000-4000-8000-0000000002a3' AND a.concluida_em IS NOT NULL))$$,
  '23505', NULL, 'X: desfazer recusado quando o cliente já tem outra agenda aberta');

-- (SG) imutáveis
SELECT throws_ok(
  $$UPDATE public.agenda_contatos SET owner_id = 'a6e0d000-0000-4000-8000-0000000001a3' WHERE lead_id = 'a6e0d000-0000-4000-8000-0000000002a2'$$,
  '42501', NULL, 'SG: o dono da agenda não muda');

-- ===========================================================================
-- Outra org
-- ===========================================================================
SELECT pg_temp.como('a6e0d000-0000-4000-8000-0000000000b1');

SELECT throws_ok(
  $$SELECT * FROM public.get_agenda_contatos('a6e0d000-0000-4000-8000-00000000000a')$$,
  '42501', NULL, 'SG: admin de outra org é recusado');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT bool_or(prosecdef) FROM pg_proc WHERE proname IN ('get_agenda_contatos', 'get_agenda_contatos_resumo', 'agenda_contato_marcar', 'agenda_contato_concluir', 'agenda_contato_reabrir')),
  false, 'SG: todas SECURITY INVOKER (a RLS decide)');
SELECT is(
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN ('get_agenda_contatos', 'get_agenda_contatos_resumo', 'agenda_contato_marcar', 'agenda_contato_concluir', 'agenda_contato_reabrir')),
  false, 'SG: anon sem EXECUTE');

SELECT * FROM finish();
ROLLBACK;

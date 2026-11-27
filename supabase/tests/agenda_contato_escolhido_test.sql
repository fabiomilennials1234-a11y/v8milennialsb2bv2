-- supabase/tests/agenda_contato_escolhido_test.sql
--
-- Contato escolhido no "Nova agenda" (migration 20280130000000_agenda_contato_escolhido.sql).
--
--   (ES) esquema: colunas, FK ON DELETE SET NULL, trava DEFINER sem EXECUTE.
--   (AG) próximo contato: marca com o contato, remarcar sem contato MANTÉM,
--        remarcar com outro TROCA, a lista devolve nome e número do escolhido.
--   (RE) reunião: grava o contato; editar sem mexer no contato mantém.
--   (TR) trava: contato de outro cliente, de outra org ou apagado é recusado;
--        fusão (só o cliente muda) limpa o vínculo em silêncio.
--   (CO) compatibilidade: a chamada de 5 argumentos do front antigo continua.
--
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(26);

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('a6e0e000-0000-4000-8000-00000000000a', 'Org CT A', 'org-ct-a', 'America/Sao_Paulo', '{}'::jsonb),
  ('a6e0e000-0000-4000-8000-00000000000b', 'Org CT B', 'org-ct-b', 'America/Sao_Paulo', '{}'::jsonb)
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
    ('a6e0e000-0000-4000-8000-0000000000a2', 'ct-vend-a@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('a6e0e000-0000-4000-8000-0000000001a2', 'a6e0e000-0000-4000-8000-00000000000a', 'a6e0e000-0000-4000-8000-0000000000a2', 'Vend CT', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, company, phone, origin) VALUES
  ('a6e0e000-0000-4000-8000-0000000002a1', 'a6e0e000-0000-4000-8000-00000000000a', 'Alfa Bar',  'Alfa LTDA', '5548999990001', 'meta_ads'),
  ('a6e0e000-0000-4000-8000-0000000002a2', 'a6e0e000-0000-4000-8000-00000000000a', 'Beta Loja', NULL,        '5548999990002', 'meta_ads'),
  ('a6e0e000-0000-4000-8000-0000000002b1', 'a6e0e000-0000-4000-8000-00000000000b', 'Lead da B', NULL,        '5548999990009', 'meta_ads');

-- Alfa: dois contatos vivos e um apagado. Beta: um contato. Lead da B: um.
INSERT INTO public.lead_phones (id, organization_id, lead_id, phone, label, is_primary, source, deleted_at) VALUES
  ('a6e0e000-0000-4000-8000-0000000003a1', 'a6e0e000-0000-4000-8000-00000000000a', 'a6e0e000-0000-4000-8000-0000000002a1', '5548999990001', 'Carlos - Compras',    true,  'erp', NULL),
  ('a6e0e000-0000-4000-8000-0000000003a2', 'a6e0e000-0000-4000-8000-00000000000a', 'a6e0e000-0000-4000-8000-0000000002a1', '5548988880001', 'Ana - Financeiro',    false, 'erp', NULL),
  ('a6e0e000-0000-4000-8000-0000000003a3', 'a6e0e000-0000-4000-8000-00000000000a', 'a6e0e000-0000-4000-8000-0000000002a1', '5548977770001', 'Antigo',              false, 'crm', now()),
  ('a6e0e000-0000-4000-8000-0000000003a4', 'a6e0e000-0000-4000-8000-00000000000a', 'a6e0e000-0000-4000-8000-0000000002a2', '5548999990002', 'Bruno',               true,  'crm', NULL),
  ('a6e0e000-0000-4000-8000-0000000003b1', 'a6e0e000-0000-4000-8000-00000000000b', 'a6e0e000-0000-4000-8000-0000000002b1', '5548999990009', 'Contato da B',        true,  'crm', NULL);

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (ES) esquema
-- ===========================================================================
SELECT has_column('public', 'agenda_contatos', 'lead_phone_id', 'ES: agenda_contatos.lead_phone_id existe');
SELECT has_column('public', 'meetings', 'lead_phone_id', 'ES: meetings.lead_phone_id existe');
SELECT is(
  (SELECT string_agg(c.conrelid::regclass::text || ':' || c.confdeltype::text, ',' ORDER BY c.conrelid::regclass::text)
     FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = 'public.lead_phones'::regclass
      AND c.conrelid IN ('public.agenda_contatos'::regclass, 'public.meetings'::regclass)),
  'agenda_contatos:n,meetings:n',
  'ES: as duas FKs são ON DELETE SET NULL (telefone apagado não apaga a agenda)');
SELECT is(
  (SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = 'public.fn_lead_phone_do_mesmo_lead()'::regprocedure),
  true, 'ES: a trava é SECURITY DEFINER com search_path vazio');
SELECT is(
  (SELECT has_function_privilege('authenticated', 'public.fn_lead_phone_do_mesmo_lead()', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_lead_phone_do_mesmo_lead()', 'EXECUTE')),
  false, 'ES: ninguém de fora executa a trava');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agenda_contato_marcar'),
  1, 'ES: uma só agenda_contato_marcar (a de 5 argumentos saiu, sem sobrecarga ambígua)');
SELECT is(
  (SELECT (has_function_privilege('anon', 'public.agenda_contato_marcar(uuid,uuid,date,text,uuid,uuid)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.agenda_contato_marcar(uuid,uuid,date,text,uuid,uuid)', 'EXECUTE'),
           has_function_privilege('anon', 'public.get_agenda_contatos(uuid,boolean,integer)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.get_agenda_contatos(uuid,boolean,integer)', 'EXECUTE'))::text),
  '(f,t,f,t)', 'ES: grants refeitos — authenticated executa, anon não');

-- Atalho de persona (o JWT decide quem é "eu").
CREATE FUNCTION pg_temp.como(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SELECT NULL::void
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como(text) TO authenticated;

SET LOCAL role authenticated;
SELECT pg_temp.como('a6e0e000-0000-4000-8000-0000000000a2');

-- ===========================================================================
-- (AG) próximo contato
-- ===========================================================================
SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar(p_org => 'a6e0e000-0000-4000-8000-00000000000a', p_lead => 'a6e0e000-0000-4000-8000-0000000002a1',
           p_data => current_date + 3, p_lead_phone => 'a6e0e000-0000-4000-8000-0000000003a2')$$,
  'AG: marca a agenda com o contato escolhido');
SELECT is(
  (SELECT (lead_phone_id, contato_nome, contato_telefone, lead_phone)::text FROM public.get_agenda_contatos('a6e0e000-0000-4000-8000-00000000000a') WHERE lead_name = 'Alfa Bar'),
  '(a6e0e000-0000-4000-8000-0000000003a2,"Ana - Financeiro",5548988880001,5548999990001)',
  'AG: a lista devolve o contato escolhido e mantém o principal do lead');
SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar('a6e0e000-0000-4000-8000-00000000000a', 'a6e0e000-0000-4000-8000-0000000002a1', current_date + 5)$$,
  'AG: remarcar pela pílula de data (sem contato)');
SELECT is(
  (SELECT (data_agenda - current_date, contato_nome)::text FROM public.get_agenda_contatos('a6e0e000-0000-4000-8000-00000000000a') WHERE lead_name = 'Alfa Bar'),
  '(5,"Ana - Financeiro")',
  'AG: remarcar sem contato troca a data e MANTÉM o contato');
SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar(p_org => 'a6e0e000-0000-4000-8000-00000000000a', p_lead => 'a6e0e000-0000-4000-8000-0000000002a1',
           p_data => current_date + 5, p_lead_phone => 'a6e0e000-0000-4000-8000-0000000003a1')$$,
  'AG: remarcar escolhendo outro contato');
SELECT is(
  (SELECT (count(*), max(contato_nome))::text FROM public.get_agenda_contatos('a6e0e000-0000-4000-8000-00000000000a') WHERE lead_name = 'Alfa Bar'),
  '(1,"Carlos - Compras")',
  'AG: troca o contato da MESMA agenda (continua uma por cliente e dono)');

-- ===========================================================================
-- (TR) trava
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.agenda_contato_marcar(p_org => 'a6e0e000-0000-4000-8000-00000000000a', p_lead => 'a6e0e000-0000-4000-8000-0000000002a1',
           p_data => current_date + 1, p_lead_phone => 'a6e0e000-0000-4000-8000-0000000003a4')$$,
  '22023', NULL, 'TR: contato de OUTRO cliente é recusado');
SELECT throws_ok(
  $$SELECT public.agenda_contato_marcar(p_org => 'a6e0e000-0000-4000-8000-00000000000a', p_lead => 'a6e0e000-0000-4000-8000-0000000002a1',
           p_data => current_date + 1, p_lead_phone => 'a6e0e000-0000-4000-8000-0000000003a3')$$,
  '22023', NULL, 'TR: contato apagado é recusado');
SELECT throws_ok(
  $$SELECT public.agenda_contato_marcar(p_org => 'a6e0e000-0000-4000-8000-00000000000a', p_lead => 'a6e0e000-0000-4000-8000-0000000002a1',
           p_data => current_date + 1, p_lead_phone => 'a6e0e000-0000-4000-8000-0000000003b1')$$,
  '22023', NULL, 'TR: contato de outra org é recusado');
SELECT is(
  (SELECT contato_nome FROM public.get_agenda_contatos('a6e0e000-0000-4000-8000-00000000000a') WHERE lead_name = 'Alfa Bar'),
  'Carlos - Compras', 'TR: a recusa não mexeu na agenda que já existia');

-- ===========================================================================
-- (CO) chamada do front antigo (5 argumentos nomeados)
-- ===========================================================================
SELECT lives_ok(
  $$SELECT public.agenda_contato_marcar(p_org => 'a6e0e000-0000-4000-8000-00000000000a', p_lead => 'a6e0e000-0000-4000-8000-0000000002a2',
           p_data => current_date, p_observacao => NULL, p_owner => NULL)$$,
  'CO: a chamada de 5 argumentos continua funcionando');
SELECT is(
  (SELECT (lead_phone_id IS NULL AND contato_nome IS NULL AND contato_telefone IS NULL) FROM public.get_agenda_contatos('a6e0e000-0000-4000-8000-00000000000a') WHERE lead_name = 'Beta Loja'),
  true, 'CO: sem contato escolhido, as colunas novas vêm nulas');

-- ===========================================================================
-- (RE) reunião
-- ===========================================================================
SELECT lives_ok(
  $$INSERT INTO public.meetings (id, organization_id, title, start_at, end_at, lead_id, lead_phone_id, created_by)
    VALUES ('a6e0e000-0000-4000-8000-0000000004a1', 'a6e0e000-0000-4000-8000-00000000000a', 'Reunião - Alfa Bar',
            now() + interval '1 day', now() + interval '1 day 1 hour',
            'a6e0e000-0000-4000-8000-0000000002a1', 'a6e0e000-0000-4000-8000-0000000003a2', 'a6e0e000-0000-4000-8000-0000000000a2')$$,
  'RE: reunião grava o contato escolhido');
SELECT throws_ok(
  $$INSERT INTO public.meetings (organization_id, title, start_at, end_at, lead_id, lead_phone_id, created_by)
    VALUES ('a6e0e000-0000-4000-8000-00000000000a', 'Reunião - Alfa Bar', now(), now() + interval '1 hour',
            'a6e0e000-0000-4000-8000-0000000002a1', 'a6e0e000-0000-4000-8000-0000000003a4', 'a6e0e000-0000-4000-8000-0000000000a2')$$,
  '22023', NULL, 'TR: reunião com contato de outro cliente é recusada');
SELECT throws_ok(
  $$UPDATE public.meetings SET lead_phone_id = 'a6e0e000-0000-4000-8000-0000000003a4' WHERE id = 'a6e0e000-0000-4000-8000-0000000004a1'$$,
  '22023', NULL, 'TR: trocar para contato de outro cliente é recusado');
SELECT lives_ok(
  $$UPDATE public.meetings SET title = 'Reunião - Alfa Bar (pauta)', start_at = start_at + interval '1 hour' WHERE id = 'a6e0e000-0000-4000-8000-0000000004a1'$$,
  'RE: editar a reunião sem mexer no contato');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT lead_phone_id FROM public.meetings WHERE id = 'a6e0e000-0000-4000-8000-0000000004a1'),
  'a6e0e000-0000-4000-8000-0000000003a2'::uuid, 'RE: a edição manteve o contato');

-- Fusão: a reunião passa para outro cliente. O contato antigo não vale mais
-- e some em silêncio — a fusão não pode cair por causa dele.
-- (`booked_event_id` sai junto: a marcação é do cliente antigo, e a trava de
-- booking recusaria a troca sem isso — como numa fusão de verdade.)
UPDATE public.meetings SET lead_id = 'a6e0e000-0000-4000-8000-0000000002a2', booked_event_id = NULL WHERE id = 'a6e0e000-0000-4000-8000-0000000004a1';
SELECT is(
  (SELECT (lead_id, lead_phone_id)::text FROM public.meetings WHERE id = 'a6e0e000-0000-4000-8000-0000000004a1'),
  '(a6e0e000-0000-4000-8000-0000000002a2,)', 'TR: fusão troca o cliente e limpa o contato antigo');

-- Contato apagado depois de escolhido: a lista cai no principal.
UPDATE public.lead_phones SET deleted_at = now(), is_primary = false WHERE id = 'a6e0e000-0000-4000-8000-0000000003a1';
SET LOCAL role authenticated;
SELECT pg_temp.como('a6e0e000-0000-4000-8000-0000000000a2');
SELECT is(
  (SELECT (contato_nome IS NULL AND contato_telefone IS NULL) FROM public.get_agenda_contatos('a6e0e000-0000-4000-8000-00000000000a') WHERE lead_name = 'Alfa Bar'),
  true, 'AG: contato apagado depois de escolhido volta nulo (a tela usa o principal)');

RESET role;
SELECT * FROM finish();
ROLLBACK;

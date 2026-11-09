-- supabase/tests/telefone_isolado_por_lead_test.sql
--
-- Telefone isolado por lead (hotfix Café Jurerê; migration
-- 20271229000000_telefone_isolado_por_lead.sql).
--
--   (ON)  org COM a flag, usuário autenticado:
--         trocar para número de outro lead -> passa, marca SÓ este lead, dono
--         intacto, trilha em lead_history; voltar para número livre -> desmarca;
--         RPC salvar_telefones_do_lead sem p_permitir_compartilhado -> passa.
--   (INS) INSERT com número existente segue recusando (23505).
--   (OFF) org SEM a flag: troca para número de outro lead -> 23505, como antes.
--   (SVC) sem auth.uid() (ERP, service_role): 23505 mesmo com a flag.
--
-- Roda inteiro em transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (gatilhos OFF no seed; normalized_phone explícito)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('15011109-0000-4000-8000-00000000000a', 'Org ISO ON',  'org-iso-on',  'America/Sao_Paulo', '{"telefone_isolado_por_lead": true}'::jsonb),
  ('15011109-0000-4000-8000-00000000000b', 'Org ISO OFF', 'org-iso-off', 'America/Sao_Paulo', '{}'::jsonb)
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
    ('15011109-0000-4000-8000-0000000000a1', 'iso-admin-on@test.local'),
    ('15011109-0000-4000-8000-0000000000b1', 'iso-admin-off@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('15011109-0000-4000-8000-0000000001a1', '15011109-0000-4000-8000-00000000000a', '15011109-0000-4000-8000-0000000000a1', 'Admin ON',  'admin', true),
  ('15011109-0000-4000-8000-0000000001b1', '15011109-0000-4000-8000-00000000000b', '15011109-0000-4000-8000-0000000000b1', 'Admin OFF', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, phone_compartilhado, origin, created_at) VALUES
  -- ON: B é o dono de 11933330001; A tem outro número.
  ('15011109-0000-4000-8000-0000000002a1', '15011109-0000-4000-8000-00000000000a', 'Cliente B', '11933330001', '11933330001', false, 'erp_toth', '2026-01-01'),
  ('15011109-0000-4000-8000-0000000002a2', '15011109-0000-4000-8000-00000000000a', 'Cliente A', '11933330002', '11933330002', false, 'erp_toth', '2026-01-02'),
  ('15011109-0000-4000-8000-0000000002a3', '15011109-0000-4000-8000-00000000000a', 'Cliente C', '11933330003', '11933330003', false, 'erp_toth', '2026-01-03'),
  -- OFF: mesmo cenário.
  ('15011109-0000-4000-8000-0000000002b1', '15011109-0000-4000-8000-00000000000b', 'Cliente B', '11933330001', '11933330001', false, 'erp_toth', '2026-01-01'),
  ('15011109-0000-4000-8000-0000000002b2', '15011109-0000-4000-8000-00000000000b', 'Cliente A', '11933330002', '11933330002', false, 'erp_toth', '2026-01-02');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (ON) admin da org com a flag
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"15011109-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.leads SET phone = '(11) 93333-0001' WHERE id = '15011109-0000-4000-8000-0000000002a2'$$,
  'ON: A troca para o número do B sem erro');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT phone_compartilhado FROM public.leads WHERE id = '15011109-0000-4000-8000-0000000002a2'),
  true, 'ON: A fica compartilhado');

SELECT is(
  (SELECT (phone, phone_compartilhado)::text FROM public.leads WHERE id = '15011109-0000-4000-8000-0000000002a1'),
  '(11933330001,f)', 'ON: B (dono) não muda');

SELECT is(
  (SELECT count(*)::int FROM public.lead_history
    WHERE lead_id = '15011109-0000-4000-8000-0000000002a2' AND action = 'phone_shared'
      AND metadata->>'automatico' = 'telefone_isolado_por_lead'
      AND created_by = '15011109-0000-4000-8000-0000000000a1'),
  1, 'ON: trilha phone_shared com o usuário');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"15011109-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.leads SET phone = '11933330009' WHERE id = '15011109-0000-4000-8000-0000000002a2'$$,
  'ON: A troca para número livre');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT phone_compartilhado FROM public.leads WHERE id = '15011109-0000-4000-8000-0000000002a2'),
  false, 'ON: número livre -> A vira dono (desmarca)');

SELECT is(
  (SELECT count(*)::int FROM public.lead_history
    WHERE lead_id = '15011109-0000-4000-8000-0000000002a2' AND action = 'phone_unshared'
      AND metadata->>'automatico' = 'telefone_isolado_por_lead'),
  1, 'ON: trilha phone_unshared');

-- RPC da ficha (Contatos) sem p_permitir_compartilhado: não pede mais confirmação.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"15011109-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.salvar_telefones_do_lead('15011109-0000-4000-8000-0000000002a3',
      '[{"phone":"11933330001","is_primary":true}]'::jsonb)$$,
  'ON: RPC da ficha troca C para o número do B sem confirmação');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT (normalized_phone, phone_compartilhado)::text FROM public.leads WHERE id = '15011109-0000-4000-8000-0000000002a3'),
  '(11933330001,t)', 'ON: C com o número e compartilhado');

SELECT is(
  (SELECT phone_compartilhado FROM public.leads WHERE id = '15011109-0000-4000-8000-0000000002a1'),
  false, 'ON: B segue dono depois da RPC');

-- ===========================================================================
-- (INS) INSERT com número existente segue recusando, mesmo com a flag
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"15011109-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, origin)
    VALUES ('15011109-0000-4000-8000-00000000000a', 'Novo', '11933330001', 'meta_ads')$$,
  '23505', NULL, 'INS: lead novo com número existente segue recusando');

-- ===========================================================================
-- (SVC) sem auth.uid(): ERP / service_role seguem o índice
-- ===========================================================================
SELECT set_config('request.jwt.claims', '', true);

SELECT throws_ok(
  $$UPDATE public.leads SET phone = '11933330001' WHERE id = '15011109-0000-4000-8000-0000000002a2'$$,
  '23505', NULL, 'SVC: sem usuário, flag não vale');

-- ===========================================================================
-- (OFF) org sem a flag
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"15011109-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

SELECT throws_ok(
  $$UPDATE public.leads SET phone = '11933330001' WHERE id = '15011109-0000-4000-8000-0000000002b2'$$,
  '23505', NULL, 'OFF: org sem flag recusa como antes');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT phone_compartilhado FROM public.leads WHERE id = '15011109-0000-4000-8000-0000000002b2'),
  false, 'OFF: A não foi marcado');

SELECT * FROM finish();
ROLLBACK;

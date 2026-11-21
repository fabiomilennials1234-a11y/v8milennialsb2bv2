-- supabase/tests/vincular_numero_a_lead_test.sql
--
-- "Vincular a cliente existente" no chat (migration 20280111000000).
-- Depende de escolher_lead_do_numero (20280102000000, PR #2470): rode com as
-- duas migrations quando a preview ainda não tiver a do #2470.
--
--   (VI) número sem lead: vira telefone do cliente, conversa e mensagens religadas.
--   (ID) idempotente: vincular de novo não duplica o telefone.
--   (PR) a próxima mensagem do número chega ligada sozinha.
--   (CP) número compartilhado: a conversa vai para o cliente escolhido.
--   (SG) lead de outra org / apagado recusado; outra org recusada; INVOKER; anon.
--
-- Persona: admin da org (vê todas as caixas). Transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('b17c0000-0000-4000-8000-00000000000a', 'Org VN A', 'org-vn-a', 'America/Sao_Paulo', '{}'::jsonb),
  ('b17c0000-0000-4000-8000-00000000000b', 'Org VN B', 'org-vn-b', 'America/Sao_Paulo', '{}'::jsonb)
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
    ('b17c0000-0000-4000-8000-0000000000a1', 'vn-admin-a@test.local'),
    ('b17c0000-0000-4000-8000-0000000000b1', 'vn-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('b17c0000-0000-4000-8000-0000000001a1', 'b17c0000-0000-4000-8000-00000000000a', 'b17c0000-0000-4000-8000-0000000000a1', 'Admin VN A', 'admin', true),
  ('b17c0000-0000-4000-8000-0000000001b1', 'b17c0000-0000-4000-8000-00000000000b', 'b17c0000-0000-4000-8000-0000000000b1', 'Admin VN B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider, status) VALUES
  ('b17c0000-0000-4000-8000-0000000003a1', 'b17c0000-0000-4000-8000-00000000000a', 'vn-a', 'uazapi', 'connected');

-- Cliente do ERP com OUTRO número no cadastro; um 2º cliente; um lead apagado;
-- um lead de outra org.
INSERT INTO public.leads (id, organization_id, name, phone, erp_code, origin, deleted_at) VALUES
  ('b17c0000-0000-4000-8000-0000000002a1', 'b17c0000-0000-4000-8000-00000000000a', 'Cliente ERP',   '48911110000', '9001', 'meta_ads', NULL),
  ('b17c0000-0000-4000-8000-0000000002a2', 'b17c0000-0000-4000-8000-00000000000a', 'Outro Cliente', '48933330000', '9002', 'meta_ads', NULL),
  ('b17c0000-0000-4000-8000-0000000002a9', 'b17c0000-0000-4000-8000-00000000000a', 'Apagado',       '48944440000', NULL,   'meta_ads', now()),
  ('b17c0000-0000-4000-8000-0000000002b1', 'b17c0000-0000-4000-8000-00000000000b', 'Lead da B',     '48955550000', NULL,   'meta_ads', NULL);

-- Conversa do número 48 92222-0000 (não está em lead nenhum), sem lead.
INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, normalized_phone, direction, message_type, content, status, timestamp) VALUES
  ('b17c0000-0000-4000-8000-00000000000a', 'b17c0000-0000-4000-8000-0000000003a1', 'vn-m1', '5548922220000@s.whatsapp.net', '5548922220000', '48922220000', 'incoming', 'text', 'Oi, aqui é do Cliente ERP', 'received', now() - interval '1 hour'),
  ('b17c0000-0000-4000-8000-00000000000a', 'b17c0000-0000-4000-8000-0000000003a1', 'vn-m2', '5548922220000@s.whatsapp.net', '5548922220000', '48922220000', 'outgoing', 'text', 'Olá!', 'sent', now() - interval '50 minutes');
INSERT INTO public.whatsapp_conversation_summary (organization_id, instance_id, normalized_phone, phone_number, last_message, last_message_time, last_message_direction, lead_id, is_group) VALUES
  ('b17c0000-0000-4000-8000-00000000000a', 'b17c0000-0000-4000-8000-0000000003a1', '48922220000', '5548922220000', 'Olá!', now() - interval '50 minutes', 'outgoing', NULL, false);

-- Conversa de número COMPARTILHADO: 48 93333-0000 é do Outro Cliente e entra
-- também como telefone de um 3º cadastro — a conversa ficou sem lead (ambígua).
INSERT INTO public.leads (id, organization_id, name, phone, origin) VALUES
  ('b17c0000-0000-4000-8000-0000000002a3', 'b17c0000-0000-4000-8000-00000000000a', 'Terceiro', '48933330000', 'meta_ads');
INSERT INTO public.whatsapp_conversation_summary (organization_id, instance_id, normalized_phone, phone_number, last_message, last_message_time, last_message_direction, lead_id, is_group) VALUES
  ('b17c0000-0000-4000-8000-00000000000a', 'b17c0000-0000-4000-8000-0000000003a1', '48933330000', '5548933330000', 'Bom dia', now() - interval '2 hours', 'incoming', NULL, false);

SET LOCAL session_replication_role = origin;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b17c0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- (VI)
SELECT lives_ok(
  $$SELECT public.vincular_numero_a_lead('b17c0000-0000-4000-8000-00000000000a', '5548922220000', 'b17c0000-0000-4000-8000-0000000002a1')$$,
  'VI: admin vincula a conversa ao cliente que já existe');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT lead_id FROM public.whatsapp_conversation_summary WHERE organization_id = 'b17c0000-0000-4000-8000-00000000000a' AND normalized_phone = '48922220000'),
  'b17c0000-0000-4000-8000-0000000002a1'::uuid,
  'VI: a conversa (resumo que o chat lê) passa a mostrar o cliente');
SELECT is(
  (SELECT count(*)::int FROM public.whatsapp_messages WHERE organization_id = 'b17c0000-0000-4000-8000-00000000000a' AND normalized_phone = '48922220000' AND lead_id = 'b17c0000-0000-4000-8000-0000000002a1'),
  2, 'VI: as mensagens antigas da conversa ficam no cliente');
SELECT is(
  (SELECT (source, is_primary)::text FROM public.lead_phones WHERE lead_id = 'b17c0000-0000-4000-8000-0000000002a1' AND normalized_phone = '48922220000' AND deleted_at IS NULL),
  '(crm,f)', 'VI: o número vira telefone do cliente (CRM, não principal)');

-- (PR) a próxima mensagem chega ligada sozinha
INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, normalized_phone, direction, message_type, content, status, timestamp) VALUES
  ('b17c0000-0000-4000-8000-00000000000a', 'b17c0000-0000-4000-8000-0000000003a1', 'vn-m3', '5548922220000@s.whatsapp.net', '5548922220000', '48922220000', 'incoming', 'text', 'Quero fazer um pedido', 'received', now());
SELECT is(
  (SELECT lead_id FROM public.whatsapp_messages WHERE message_id = 'vn-m3'),
  'b17c0000-0000-4000-8000-0000000002a1'::uuid,
  'PR: mensagem nova do número já nasce no cliente');

-- (ID) idempotente
SET LOCAL role authenticated;
SELECT public.vincular_numero_a_lead('b17c0000-0000-4000-8000-00000000000a', '48922220000', 'b17c0000-0000-4000-8000-0000000002a1');
RESET role;
SET LOCAL role postgres;
SELECT is(
  (SELECT count(*)::int FROM public.lead_phones WHERE lead_id = 'b17c0000-0000-4000-8000-0000000002a1' AND normalized_phone = '48922220000' AND deleted_at IS NULL),
  1, 'ID: vincular de novo não duplica o telefone');

-- (CP) número compartilhado: a conversa vai para o cliente escolhido
SET LOCAL role authenticated;
SELECT public.vincular_numero_a_lead('b17c0000-0000-4000-8000-00000000000a', '48933330000', 'b17c0000-0000-4000-8000-0000000002a1');
RESET role;
SET LOCAL role postgres;
SELECT is(
  (SELECT lead_id FROM public.whatsapp_conversation_summary WHERE organization_id = 'b17c0000-0000-4000-8000-00000000000a' AND normalized_phone = '48933330000'),
  'b17c0000-0000-4000-8000-0000000002a1'::uuid,
  'CP: número em vários cadastros — a conversa vai para o cliente escolhido');

-- (SG)
SET LOCAL role authenticated;
SELECT throws_ok(
  $$SELECT public.vincular_numero_a_lead('b17c0000-0000-4000-8000-00000000000a', '48922220000', 'b17c0000-0000-4000-8000-0000000002b1')$$,
  'P0002', NULL, 'SG: cliente de outra org é recusado');
SELECT throws_ok(
  $$SELECT public.vincular_numero_a_lead('b17c0000-0000-4000-8000-00000000000a', '48922220000', 'b17c0000-0000-4000-8000-0000000002a9')$$,
  'P0002', NULL, 'SG: cliente apagado é recusado');

SELECT set_config('request.jwt.claims',
  '{"sub":"b17c0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.vincular_numero_a_lead('b17c0000-0000-4000-8000-00000000000a', '48922220000', 'b17c0000-0000-4000-8000-0000000002a1')$$,
  NULL, NULL, 'SG: usuário de outra org é recusado');

RESET role;
SET LOCAL role postgres;

SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'vincular_numero_a_lead'),
  false, 'SG: SECURITY INVOKER (a policy de lead_phones decide)');
SELECT is(
  has_function_privilege('anon', (SELECT oid FROM pg_proc WHERE proname = 'vincular_numero_a_lead'), 'EXECUTE'),
  false, 'SG: anon sem EXECUTE');

SELECT * FROM finish();
ROLLBACK;

-- supabase/tests/get_conversas_do_lead_test.sql
--
-- Mapa #1605 / spec `.specs/features/conversa-do-lead/SPEC.md` — pgTAP da RPC
-- que alimenta o seletor de Conversa do Lead.
--
-- Run:
--   supabase test db
-- ou:
--   pg_prove -d "$DATABASE_URL" supabase/tests/get_conversas_do_lead_test.sql
--
-- Asserts:
--   (a) assinatura, SECURITY INVOKER, search_path fixado
--   (b) grants: authenticated executa, anon e PUBLIC não
--   (c) CONTROLE POSITIVO — o membro vê as caixas da própria org
--       (sem isto, um resultado vazio por engano passaria como "isolado")
--   (d) última mensagem por caixa: a mais recente, com direção
--   (e) caixa sem conversa vem na lista, com campos nulos
--   (f) mensagem apagada (`deleted_at`) não conta como última
--   (g) CROSS-TENANT — membro da org A não enxerga caixa nem conversa da org B
--   (h) caixa em `status = 'error'` não aparece
--
-- Rodado como role `authenticated`, nunca como superuser: postgres bypassa RLS
-- e transformaria o teste de isolamento em falso verde.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ---------------------------------------------------------------------------
-- Fixture — duas orgs, um membro em cada
--
-- `session_replication_role = replica` desliga os triggers durante a montagem:
-- `enforce_seat_limit` em `team_members` chama `assert_org_access`, que nega
-- porque na montagem ainda não há usuário autenticado. Padrão já usado em
-- assert_org_access_test.sql e outros.
--
-- ⚠️ Volta para `origin` ANTES das mensagens: o trigger
-- `normalize_whatsapp_message_phone` é quem preenche `normalized_phone`, e é
-- exatamente a coluna que a RPC consulta. Montar as mensagens com os triggers
-- desligados deixaria `normalized_phone` nulo e o teste passaria a provar nada.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, aud, role)
VALUES
  ('c0d21605-0001-0000-0000-000000001605', 'a@conversa.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('c0d21605-0002-0000-0000-000000001605', 'b@conversa.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug)
VALUES
  ('c0d21605-aaaa-0000-0000-000000001605', 'Org A — Conversa do Lead', 'org-a-conversa-1605'),
  ('c0d21605-bbbb-0000-0000-000000001605', 'Org B — Conversa do Lead', 'org-b-conversa-1605');

INSERT INTO team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('c0d21605-1111-0000-0000-000000001605', 'c0d21605-aaaa-0000-0000-000000001605',
   'c0d21605-0001-0000-0000-000000001605', 'Membro A', 'member', true),
  ('c0d21605-2222-0000-0000-000000001605', 'c0d21605-bbbb-0000-0000-000000001605',
   'c0d21605-0002-0000-0000-000000001605', 'Membro B', 'member', true);

-- Org A: uma caixa com conversa, uma sem, uma em erro.
INSERT INTO whatsapp_instances (id, organization_id, instance_name, status)
VALUES
  ('c0d21605-a001-0000-0000-000000001605', 'c0d21605-aaaa-0000-0000-000000001605', 'A-com-conversa', 'connected'),
  ('c0d21605-a002-0000-0000-000000001605', 'c0d21605-aaaa-0000-0000-000000001605', 'A-sem-conversa', 'connected'),
  ('c0d21605-a003-0000-0000-000000001605', 'c0d21605-aaaa-0000-0000-000000001605', 'A-em-erro',      'error'),
  ('c0d21605-b001-0000-0000-000000001605', 'c0d21605-bbbb-0000-0000-000000001605', 'B-da-outra-org', 'connected');

-- Triggers de volta: `normalized_phone` sai do trigger, e é o que a RPC lê.
SET LOCAL session_replication_role = origin;

INSERT INTO whatsapp_messages
  (organization_id, instance_id, message_id, remote_jid, phone_number,
   direction, content, "timestamp", deleted_at)
VALUES
  -- Org A, caixa com conversa: a mais antiga, a mais recente, e uma apagada
  -- posterior a ambas — a apagada não pode virar "a última".
  ('c0d21605-aaaa-0000-0000-000000001605', 'c0d21605-a001-0000-0000-000000001605',
   'msg-antiga', '5548999887766@s.whatsapp.net', '5548999887766',
   'outgoing', 'mensagem antiga', now() - interval '10 days', NULL),
  ('c0d21605-aaaa-0000-0000-000000001605', 'c0d21605-a001-0000-0000-000000001605',
   'msg-recente', '5548999887766@s.whatsapp.net', '5548999887766',
   'incoming', 'mensagem recente', now() - interval '1 day', NULL),
  ('c0d21605-aaaa-0000-0000-000000001605', 'c0d21605-a001-0000-0000-000000001605',
   'msg-apagada', '5548999887766@s.whatsapp.net', '5548999887766',
   'incoming', 'mensagem apagada', now(), now()),
  -- Org B, mesmo telefone: é o que o teste cross-tenant procura não ver.
  ('c0d21605-bbbb-0000-0000-000000001605', 'c0d21605-b001-0000-0000-000000001605',
   'msg-org-b', '5548999887766@s.whatsapp.net', '5548999887766',
   'incoming', 'conversa da org B', now(), NULL);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_conversas_do_lead', ARRAY['text'],
  '(a) get_conversas_do_lead(text) existe');

SELECT is(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_conversas_do_lead'),
  false,
  '(a) é SECURITY INVOKER — a RLS do chamador é quem recorta');

SELECT ok(
  (SELECT proconfig::text LIKE '%search_path=public%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_conversas_do_lead'),
  '(a) search_path fixado');

-- ---------------------------------------------------------------------------
-- (b) Grants
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.get_conversas_do_lead(text)', 'EXECUTE'),
  '(b) authenticated pode executar');

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_conversas_do_lead(text)', 'EXECUTE'),
  '(b) anon NÃO pode executar');

-- ---------------------------------------------------------------------------
-- (c) CONTROLE POSITIVO — membro da org A vê as caixas dela
--     Sem este assert, um retorno vazio por engano passaria por "isolamento".
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0d21605-0001-0000-0000-000000001605","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_conversas_do_lead('5548999887766')),
  2::bigint,
  '(c) CONTROLE POSITIVO: membro A vê as 2 caixas ativas da própria org');

-- ---------------------------------------------------------------------------
-- (d) Última mensagem por caixa
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT last_message_content FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-a001-0000-0000-000000001605'),
  'mensagem recente',
  '(d) devolve a mensagem MAIS RECENTE da caixa, não a primeira');

SELECT is(
  (SELECT last_message_direction FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-a001-0000-0000-000000001605'),
  'incoming',
  '(d) devolve a direção da última mensagem');

-- ---------------------------------------------------------------------------
-- (e) Caixa sem conversa aparece, com campos nulos
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-a002-0000-0000-000000001605'),
  1::bigint,
  '(e) caixa SEM conversa continua na lista — é o grupo "iniciar conversa por"');

SELECT ok(
  (SELECT last_message_at IS NULL FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-a002-0000-0000-000000001605'),
  '(e) caixa sem conversa vem com last_message_at nulo');

-- ---------------------------------------------------------------------------
-- (f) Mensagem apagada não vira "a última"
-- ---------------------------------------------------------------------------
SELECT isnt(
  (SELECT last_message_content FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-a001-0000-0000-000000001605'),
  'mensagem apagada',
  '(f) mensagem com deleted_at não conta, mesmo sendo a mais recente');

-- ---------------------------------------------------------------------------
-- (g) CROSS-TENANT — o assert que justifica rodar como authenticated
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-b001-0000-0000-000000001605'),
  0::bigint,
  '(g) membro A NÃO enxerga a caixa da org B');

SELECT is(
  (SELECT count(*) FROM public.get_conversas_do_lead('5548999887766')
    WHERE last_message_content = 'conversa da org B'),
  0::bigint,
  '(g) membro A NÃO enxerga a conversa da org B com o mesmo telefone');

-- ---------------------------------------------------------------------------
-- (h) Caixa em erro fica fora
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM public.get_conversas_do_lead('5548999887766')
    WHERE instance_id = 'c0d21605-a003-0000-0000-000000001605'),
  0::bigint,
  '(h) caixa com status = error não aparece');

SELECT * FROM finish();
ROLLBACK;

-- supabase/tests/official_whatsapp_conversation_list_test.sql
--
-- Issue #1650 / spec `.specs/notificame/CAIXA-WHATSAPP-OFICIAL.md` — pgTAP da RPC
-- que alimenta a lista da caixa de WhatsApp oficial (NotificaMe).
--
-- Run:
--   supabase test db
-- ou:
--   pg_prove -d "$DATABASE_URL" supabase/tests/official_whatsapp_conversation_list_test.sql
--
-- Asserts:
--   (a) assinatura, SECURITY DEFINER, search_path fixado
--   (b) grants: authenticated executa, anon não
--   (c) CONTROLE POSITIVO — o membro vê as conversas da própria instância
--       (sem isto, um resultado vazio por engano passaria por "isolado")
--   (d) a IDENTIDADE do contato sai da última mensagem RECEBIDA, não da última
--   (e) a ÚLTIMA MENSAGEM é a última mesmo — inclusive quando é de saída
--   (f) linha sem `contact_external_id` (os 10.982 fósseis de março) fica fora
--   (g) vínculo de lead por TELEFONE normalizado, com o nono dígito que o
--       fornecedor não manda
--   (h) CROSS-TENANT — instância de outra org é 42501, não lista vazia
--   (i) org alheia é 42501
--   (j) instância nula é 22023
--   (k) unread_count zera com a chave de leitura no namespace certo
--   (l) e NÃO zera com a chave no namespace do WhatsApp por QR
--   (m) isolamento por responsável (#1629): com a política ligada, quem não é
--       responsável não vê a conversa — e quem é, vê
--
-- Rodado como role `authenticated`, nunca como superuser: postgres bypassa RLS
-- e transformaria o teste de isolamento em falso verde.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- ---------------------------------------------------------------------------
-- Fixture — três orgs
--
--   A: política de isolamento DESLIGADA (o caso da Chique hoje)
--   B: existe só para provar o cross-tenant
--   C: política LIGADA, com responsável e não-responsável (o caso das Goletric)
--
-- `session_replication_role = replica` desliga os triggers durante a montagem:
-- `enforce_seat_limit` em `team_members` chama `assert_org_access`, que nega
-- porque na montagem ainda não há usuário autenticado. Padrão já usado em
-- assert_org_access_test.sql e outros.
--
-- ⚠️ `leads.normalized_phone` é gravada EXPLICITAMENTE chamando
-- `public.normalize_brazilian_phone()` — a mesma função que o trigger
-- `trigger_normalize_lead_phone` usa. Com os triggers desligados a coluna
-- nasceria nula, e ela é exatamente o que a RPC consulta para achar o lead.
-- Chamar a função de verdade (em vez de digitar o número normalizado à mão)
-- mantém o teste amarrado à normalização real: se ela mudar, o teste acusa.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, aud, role)
VALUES
  ('16500000-0001-0000-0000-000000001650', 'a@oficial.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('16500000-0002-0000-0000-000000001650', 'b@oficial.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('16500000-0003-0000-0000-000000001650', 'c1@oficial.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('16500000-0004-0000-0000-000000001650', 'c2@oficial.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, chat_restrict_to_owner)
VALUES
  ('16500000-aaaa-0000-0000-000000001650', 'Org A — Caixa Oficial', 'org-a-oficial-1650', false),
  ('16500000-bbbb-0000-0000-000000001650', 'Org B — Caixa Oficial', 'org-b-oficial-1650', false),
  ('16500000-cccc-0000-0000-000000001650', 'Org C — Caixa Oficial', 'org-c-oficial-1650', true);

-- ⚠️ role `member`, não `membro`: o enum app_role é
-- {admin,sdr,closer,agency,bdr,cliente,member}. O CLAUDE.md do repo diz
-- 'membro' e está errado — um valor inexistente aborta a montagem inteira e a
-- suíte passaria por ausência de asserção.
INSERT INTO team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('16500000-a001-0000-0000-000000001650', '16500000-aaaa-0000-0000-000000001650',
   '16500000-0001-0000-0000-000000001650', 'Membro A', 'member', true),
  ('16500000-b001-0000-0000-000000001650', '16500000-bbbb-0000-0000-000000001650',
   '16500000-0002-0000-0000-000000001650', 'Membro B', 'member', true),
  ('16500000-c001-0000-0000-000000001650', '16500000-cccc-0000-0000-000000001650',
   '16500000-0003-0000-0000-000000001650', 'Responsável C', 'member', true),
  ('16500000-c002-0000-0000-000000001650', '16500000-cccc-0000-0000-000000001650',
   '16500000-0004-0000-0000-000000001650', 'Outro C', 'member', true);

INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status)
VALUES
  ('16500000-a1a1-0000-0000-000000001650', '16500000-aaaa-0000-0000-000000001650',
   'Oficial A', 'notificame', 'connected'),
  ('16500000-b1b1-0000-0000-000000001650', '16500000-bbbb-0000-0000-000000001650',
   'Oficial B', 'notificame', 'connected'),
  ('16500000-c1c1-0000-0000-000000001650', '16500000-cccc-0000-0000-000000001650',
   'Oficial C', 'notificame', 'connected');

INSERT INTO leads (id, organization_id, name, phone, normalized_phone, sale_responsible_id)
VALUES
  -- Casa com o contato '554884334050' SÓ depois da normalização (o fornecedor
  -- manda 10 dígitos locais; o lead tem os 11 com o nono dígito).
  ('16500000-1ead-0000-0000-000000001650', '16500000-aaaa-0000-0000-000000001650',
   'Cliente Teste', '(48) 98433-4050',
   public.normalize_brazilian_phone('5548984334050'), NULL),
  -- Org C: o lead É de um responsável — o eixo do isolamento.
  ('16500000-1eac-0000-0000-000000001650', '16500000-cccc-0000-0000-000000001650',
   'Cliente da Goletric', '(51) 99979-7732',
   public.normalize_brazilian_phone('5551999797732'),
   '16500000-c001-0000-0000-000000001650');

-- Mensagens. `external_id` é NOT NULL e único por (external_id, channel, org).
INSERT INTO channel_messages (organization_id, channel, instance_id, external_id,
                              contact_external_id, contact_handle, sender_name,
                              direction, content, "timestamp")
VALUES
  -- Conversa 1 da org A: entrada, depois SAÍDA mais recente.
  ('16500000-aaaa-0000-0000-000000001650', 'whatsapp', '16500000-a1a1-0000-0000-000000001650',
   'ext-a-1', '554884334050', NULL, 'Gabriel Gipp',
   'incoming', 'Olá, testando a conexão', now() - interval '2 hours'),
  ('16500000-aaaa-0000-0000-000000001650', 'whatsapp', '16500000-a1a1-0000-0000-000000001650',
   'ext-a-2', '554884334050', NULL, 'Loja A',
   'outgoing', 'Oi! Como posso ajudar?', now() - interval '1 hour'),
  -- Conversa 2 da org A, mais antiga que a 1.
  ('16500000-aaaa-0000-0000-000000001650', 'whatsapp', '16500000-a1a1-0000-0000-000000001650',
   'ext-a-3', '5511988887777', NULL, 'Outro Contato',
   'incoming', 'bom dia', now() - interval '3 hours'),
  -- FÓSSIL: a forma das 10.982 linhas de março — sem contact_external_id.
  ('16500000-aaaa-0000-0000-000000001650', 'whatsapp', '16500000-a1a1-0000-0000-000000001650',
   'ext-a-fossil', NULL, NULL, NULL,
   'incoming', 'linha da era Evolution', now() - interval '4 hours'),
  -- Org B, para o cross-tenant.
  ('16500000-bbbb-0000-0000-000000001650', 'whatsapp', '16500000-b1b1-0000-0000-000000001650',
   'ext-b-1', '5548999887766', NULL, 'Contato da Org B',
   'incoming', 'conversa da org B', now() - interval '1 hour'),
  -- Org C, conversa do lead que TEM responsável.
  ('16500000-cccc-0000-0000-000000001650', 'whatsapp', '16500000-c1c1-0000-0000-000000001650',
   'ext-c-1', '5551999797732', NULL, 'Cliente da Goletric',
   'incoming', 'oi, quero orçamento', now() - interval '1 hour');

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_official_whatsapp_conversation_list',
  ARRAY['uuid','uuid','integer','timestamp with time zone'],
  '(a) get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz) existe');

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list'),
  '(a) é SECURITY DEFINER — a RLS de channel_messages não recorta aqui, os gates recortam');

SELECT ok(
  (SELECT p.proconfig::text LIKE '%search_path=public%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list'),
  '(a) search_path fixado');

-- ---------------------------------------------------------------------------
-- (b) Grants — função nova nasce com EXECUTE para PUBLIC se ninguém revogar
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated',
    'public.get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz)', 'EXECUTE'),
  '(b) authenticated pode executar');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz)', 'EXECUTE'),
  '(b) anon NÃO pode executar');

-- ---------------------------------------------------------------------------
-- (c) CONTROLE POSITIVO
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"16500000-0001-0000-0000-000000001650","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')),
  2::bigint,
  '(c) CONTROLE POSITIVO: membro A vê as 2 conversas da instância dela');

-- ---------------------------------------------------------------------------
-- (d) Identidade sai da última mensagem RECEBIDA
--     A última mensagem da conversa é de SAÍDA, e nela `sender_name` é a NOSSA
--     conta. Sair dali faria a conversa aparecer na lista com o nome da própria
--     org — o defeito vivo de useMetaMessages, na forma dele para esta caixa.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT sender_name FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id = '554884334050'),
  'Gabriel Gipp',
  '(d) o nome do contato vem da última mensagem RECEBIDA, não da última (que é nossa)');

-- ---------------------------------------------------------------------------
-- (e) …e a última mensagem é a última mesmo
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT last_message_direction FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id = '554884334050'),
  'outgoing',
  '(e) a última mensagem da conversa é a de saída — thread e identidade são CTEs distintas');

-- ---------------------------------------------------------------------------
-- (f) O fóssil sem contact_external_id não vira conversa
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id IS NULL),
  0::bigint,
  '(f) linha sem contact_external_id (fóssil da era Evolution) não aparece na lista');

-- ---------------------------------------------------------------------------
-- (g) Vínculo de lead por telefone NORMALIZADO
--     '554884334050' (como o fornecedor manda) casa com o lead cadastrado com o
--     nono dígito só porque normalize_brazilian_phone roda dos dois lados.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT lead_name FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id = '554884334050'),
  'Cliente Teste',
  '(g) o lead é encontrado por telefone normalizado, com o nono dígito que o fornecedor não manda');

-- ---------------------------------------------------------------------------
-- (h) CROSS-TENANT — o gate de tenancy do ARGUMENTO
--     Sem ele, um membro legítimo da org A leria a caixa da org B só passando o
--     uuid da instância dela.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list(
       '16500000-aaaa-0000-0000-000000001650', '16500000-b1b1-0000-0000-000000001650') $$,
  '42501', 'forbidden: instance not in org',
  '(h) instância de OUTRA org é recusada — e com erro, não com lista vazia');

-- ---------------------------------------------------------------------------
-- (i) Org alheia
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list(
       '16500000-bbbb-0000-0000-000000001650', '16500000-b1b1-0000-0000-000000001650') $$,
  '42501', 'forbidden: org not accessible',
  '(i) pedir org alheia é recusado no primeiro gate');

-- ---------------------------------------------------------------------------
-- (j) Instância nula
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list(
       '16500000-aaaa-0000-0000-000000001650', NULL) $$,
  '22023', 'instance required',
  '(j) instância nula é recusada — sem instância não há recorte');

-- ---------------------------------------------------------------------------
-- (k) e (l) — o contador de não lidas e o NAMESPACE da chave
--
-- A chave do WhatsApp por QR é fatiada por split_part(key, ':', 3) em
-- get_whatsapp_conversation_list. Se esta caixa gravasse no namespace
-- 'whatsapp:', aquela função leria o nosso contact_external_id como se fosse
-- telefone. O namespace separado é o que impede isso — e (l) é quem prova que
-- ele está sendo respeitado, em vez de o contador zerar por qualquer chave.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT unread_count FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id = '554884334050'),
  1,
  '(k) 1 mensagem recebida e nunca lida conta como não lida');

SET LOCAL role postgres;
INSERT INTO conversation_read_state (organization_id, user_id, conversation_key, last_read_at)
VALUES ('16500000-aaaa-0000-0000-000000001650', '16500000-0001-0000-0000-000000001650',
        'whatsapp:16500000-a1a1-0000-0000-000000001650:554884334050', now());
SET LOCAL role authenticated;

SELECT is(
  (SELECT unread_count FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id = '554884334050'),
  1,
  '(l) chave no namespace do WhatsApp por QR NÃO zera o contador desta caixa');

SET LOCAL role postgres;
INSERT INTO conversation_read_state (organization_id, user_id, conversation_key, last_read_at)
VALUES ('16500000-aaaa-0000-0000-000000001650', '16500000-0001-0000-0000-000000001650',
        'whatsapp_oficial:16500000-a1a1-0000-0000-000000001650:554884334050', now());
SET LOCAL role authenticated;

SELECT is(
  (SELECT unread_count FROM public.get_official_whatsapp_conversation_list(
     '16500000-aaaa-0000-0000-000000001650', '16500000-a1a1-0000-0000-000000001650')
    WHERE contact_external_id = '554884334050'),
  0,
  '(k) a chave no namespace desta caixa zera o contador');

-- ---------------------------------------------------------------------------
-- (m) Isolamento por responsável (#1629)
--
-- get_social_conversation_list NÃO aplica isso, e duas orgs têm a política
-- ligada hoje. Esta caixa nasce com o gate — aqui está a prova, nos dois
-- sentidos: o não-responsável não vê, e o responsável vê.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"16500000-0004-0000-0000-000000001650","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list(
     '16500000-cccc-0000-0000-000000001650', '16500000-c1c1-0000-0000-000000001650')),
  0::bigint,
  '(m) política LIGADA: quem não é responsável pelo lead não vê a conversa');

SELECT set_config('request.jwt.claims',
  '{"sub":"16500000-0003-0000-0000-000000001650","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list(
     '16500000-cccc-0000-0000-000000001650', '16500000-c1c1-0000-0000-000000001650')),
  1::bigint,
  '(m) CONTROLE POSITIVO do isolamento: o responsável VÊ a conversa dele');

SELECT * FROM finish();
ROLLBACK;

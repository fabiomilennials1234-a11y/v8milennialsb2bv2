-- supabase/tests/social_conversation_list_scope_test.sql
--
-- SCRUM-653 (W5 do épico SCRUM-648) — `get_social_conversation_list` passa a
-- aplicar o recorte por responsável (`can_see_chat_scope`).
--
-- ─── O QUE ESTA SUÍTE GUARDA ────────────────────────────────────────────────
--
-- Medido em produção em 2026-09-04: das CINCO funções de lista de conversa,
-- esta é a ÚNICA que não aplica `can_see_chat_scope`. As outras quatro
-- (WhatsApp por QR, canal oficial e as duas versões `_multi`) aplicam.
--
-- Duas organizations têm `chat_restrict_to_owner` ligado, e uma delas
-- (Goletric Pinheiros) tem 10.609 mensagens de Instagram em 90 dias. Hoje
-- ninguém é atingido porque as duas estão com ZERO membros ativos — o furo é
-- latente, e acorda no dia em que alguém reativar um membro.
--
-- ⚠️ CONTROLE POSITIVO DOS DOIS LADOS, sempre. Foi assim que este furo
--    sobreviveu ao conserto que fizeram no caminho de WhatsApp: mediram com
--    tráfego social zero, a lista veio vazia, e vazio passou por seguro. Onde
--    esta suíte afirma "não vê", ela afirma ao lado que "quem pode, vê".
--
-- ⚠️ No Instagram o interlocutor é IGSID, não telefone. O vínculo com o lead
--    mora em `lead_social_identities` — `channel_messages.lead_id` é cache
--    derivado e nasce nulo em toda mensagem que chega antes do vínculo existir.
--    Por isso o recorte resolve o lead POR ALI, e não pela coluna da mensagem.
--
-- Run:
--   node scripts/branch-pgtap.mjs --ref <ref> --file supabase/tests/social_conversation_list_scope_test.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ===========================================================================
-- Fixture — uma organization com a política LIGADA
--
--   org D  — `chat_restrict_to_owner = true`
--   canal  — um `messaging_channels` de Instagram na org D
--
-- Pessoas:
--   resp   — member, responsável pelo lead 1
--   outro  — member, responsável pelo lead 2, sem nenhuma permissão de exceção
--
-- Conversas (todas com mensagem `incoming` no mesmo canal):
--   IG-1 → vinculada ao lead 1 (de `resp`)
--   IG-2 → vinculada ao lead 2 (de `outro`)
--
-- ⚠️ `session_replication_role = replica` na montagem: `enforce_seat_limit` em
--    `team_members` chama `assert_org_access`, que nega porque ainda não há
--    usuário autenticado.
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, aud, role)
VALUES
  ('65300000-0001-0000-0000-000000000653', 'resp@social.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('65300000-0002-0000-0000-000000000653', 'outro@social.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('65300000-0003-0000-0000-000000000653', 'admin@social.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('65300000-0004-0000-0000-000000000653', 'master@social.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('65300000-0005-0000-0000-000000000653', 'livre@social.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('65300000-0006-0000-0000-000000000653', 'viewall@social.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- O master NÃO é team_member de organization nenhuma: é shadow cross-org, que
-- é como ele aparece em produção.
INSERT INTO public.master_users (user_id, is_active)
VALUES ('65300000-0004-0000-0000-000000000653', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug, chat_restrict_to_owner)
VALUES
  ('65300000-dddd-0000-0000-000000000653', 'Org D — restrita',
   'org-d-social-653', true),
  -- Org E existe para provar a NÃO-REGRESSÃO das 60 organizations que têm a
  -- política desligada: para elas nada pode mudar.
  ('65300000-eeee-0000-0000-000000000653', 'Org E — sem restrição',
   'org-e-social-653', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('65300000-1111-0000-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   '65300000-0001-0000-0000-000000000653', 'Resp', 'member', true),
  ('65300000-2222-0000-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   '65300000-0002-0000-0000-000000000653', 'Outro', 'member', true),
  ('65300000-3333-0000-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   '65300000-0003-0000-0000-000000000653', 'Admin', 'admin', true),
  -- Membro comum da org D com a exceção NOMINAL `leads.view_all`.
  ('65300000-6666-0000-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   '65300000-0006-0000-0000-000000000653', 'View All', 'member', true),
  -- Membro comum da org E, onde a política está desligada.
  ('65300000-5555-0000-0000-000000000653', '65300000-eeee-0000-0000-000000000653',
   '65300000-0005-0000-0000-000000000653', 'Livre', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.member_feature_permissions
  (team_member_id, organization_id, feature_key, enabled)
VALUES ('65300000-6666-0000-0000-000000000653',
        '65300000-dddd-0000-0000-000000000653', 'leads.view_all', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.messaging_channels
  (id, organization_id, channel_type, external_channel_id, subaccount_id,
   display_name, handle, status)
VALUES
  ('65300000-cccc-0000-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   'instagram', 'ext-canal-653', '65300000-5ab0-0000-0000-000000000653', '@orgd', 'orgd', 'connected'),
  ('65300000-eeec-0000-0000-000000000653', '65300000-eeee-0000-0000-000000000653',
   'instagram', 'ext-canal-654', '65300000-5ab0-0000-0000-000000000654', '@orge', 'orge', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Os dois leads, cada um com o SEU responsável.
INSERT INTO public.leads (id, organization_id, name, phone, pre_sale_responsible_id)
VALUES
  ('65300000-1ead-0000-0000-000000000001', '65300000-dddd-0000-0000-000000000653',
   'Lead do Resp',  '48911110001', '65300000-1111-0000-0000-000000000653'),
  ('65300000-1ead-0000-0000-000000000002', '65300000-dddd-0000-0000-000000000653',
   'Lead do Outro', '48911110002', '65300000-2222-0000-0000-000000000653')
ON CONFLICT (id) DO NOTHING;

-- O vínculo IGSID → lead. É a fonte da verdade do "de quem é esta conversa".
INSERT INTO public.lead_social_identities
  (id, organization_id, lead_id, provider, channel_type, external_user_id,
   messaging_channel_id)
VALUES
  ('65300000-0000-1111-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   '65300000-1ead-0000-0000-000000000001', 'notificame', 'instagram',
   'IG-1', '65300000-cccc-0000-0000-000000000653'),
  ('65300000-0000-2222-0000-000000000653', '65300000-dddd-0000-0000-000000000653',
   '65300000-1ead-0000-0000-000000000002', 'notificame', 'instagram',
   'IG-2', '65300000-cccc-0000-0000-000000000653')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- Uma mensagem recebida por conversa. `lead_id` fica NULO de propósito: é o
-- estado real de toda mensagem que chega antes de alguém vincular, e é
-- exatamente por isso que o recorte não pode depender dessa coluna.
INSERT INTO public.channel_messages
  (id, organization_id, channel, messaging_channel_id, external_id,
   contact_external_id, sender_name, direction, message_type, content,
   status, "timestamp")
VALUES
  ('65300000-0000-0000-1111-000000000653', '65300000-dddd-0000-0000-000000000653',
   'instagram', '65300000-cccc-0000-0000-000000000653', 'ext-1',
   'IG-1', 'Cliente Um', 'incoming', 'text', 'oi do lead do resp',
   'received', now() - interval '1 hour'),
  ('65300000-0000-0000-2222-000000000653', '65300000-dddd-0000-0000-000000000653',
   'instagram', '65300000-cccc-0000-0000-000000000653', 'ext-2',
   'IG-2', 'Cliente Dois', 'incoming', 'text', 'oi do lead do outro',
   'received', now() - interval '2 hours'),
  -- IG-3 NÃO tem linha em `lead_social_identities`: é a conversa que chegou e
  -- ninguém vinculou ainda. Estado comuníssimo — o webhook de entrada não cria
  -- vínculo, só humano autenticado no chat cria.
  ('65300000-0000-0000-3333-000000000653', '65300000-dddd-0000-0000-000000000653',
   'instagram', '65300000-cccc-0000-0000-000000000653', 'ext-3',
   'IG-3', 'Cliente Tres', 'incoming', 'text', 'oi, ninguem me vinculou',
   'received', now() - interval '3 hours'),
  -- Org E, política desligada: uma conversa sem vínculo nenhum.
  ('65300000-0000-0000-4444-000000000653', '65300000-eeee-0000-0000-000000000653',
   'instagram', '65300000-eeec-0000-0000-000000000653', 'ext-4',
   'IG-E1', 'Cliente da E', 'incoming', 'text', 'oi da org sem restricao',
   'received', now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;


-- ===========================================================================
-- (D) O recorte por responsável — os dois lados
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"65300000-0001-0000-0000-000000000653","role":"authenticated"}', true);

-- --- D1: CONTROLE POSITIVO ------------------------------------------------
-- Sem este assert, o D2 abaixo passaria por lista vazia — que é como o furo
-- sobreviveu da primeira vez.
SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)
    WHERE contact_external_id = 'IG-1'),
  1::bigint,
  '(D1) CONTROLE POSITIVO: o responsável VÊ a conversa do lead dele');

-- --- D2: o outro lado ------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)
    WHERE contact_external_id = 'IG-2'),
  0::bigint,
  '(D2) com chat_restrict_to_owner LIGADO, o membro NÃO vê a conversa do lead de outro');

-- --- D3: conversa SEM vínculo, membro comum -------------------------------
-- Mudança de comportamento assumida (confirmada pelo CTO): sem vínculo não há
-- como dizer de quem é a conversa, e "restringir ao dono" sem dono é a resposta
-- vazia. O D5 abaixo é o outro lado — o admin continua vendo.
SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)
    WHERE contact_external_id = 'IG-3'),
  0::bigint,
  '(D3) conversa sem lead vinculado NÃO aparece para o membro comum com a política ligada');


-- ===========================================================================
-- (D4-D5) O admin da organization não é recortado
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"65300000-0003-0000-0000-000000000653","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)),
  3::bigint,
  '(D4) o admin vê as TRÊS conversas, inclusive a de lead alheio');

SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)
    WHERE contact_external_id = 'IG-3'),
  1::bigint,
  '(D5) e vê também a conversa SEM vínculo — que some só para o membro comum');

-- ===========================================================================
-- (D6) A exceção nominal `leads.view_all`
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"65300000-0006-0000-0000-000000000653","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)),
  3::bigint,
  '(D6) membro com override `leads.view_all` vê tudo, mesmo com a política ligada');


-- ===========================================================================
-- (D7) O master em shadow
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"65300000-0004-0000-0000-000000000653","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-dddd-0000-0000-000000000653'::uuid,
     '65300000-cccc-0000-0000-000000000653'::uuid)),
  3::bigint,
  '(D7) master em shadow vê tudo — ele não é team_member de organization nenhuma');


-- ===========================================================================
-- (D8-D9) NÃO-REGRESSÃO: organization com a política DESLIGADA
--
-- São 60 das 62 em produção. Para elas, nada pode mudar — nem a conversa sem
-- vínculo, que é justamente a que some quando a política está ligada.
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"65300000-0005-0000-0000-000000000653","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-eeee-0000-0000-000000000653'::uuid,
     '65300000-eeec-0000-0000-000000000653'::uuid)),
  1::bigint,
  '(D8) política desligada: o membro comum continua vendo a conversa');

SELECT is(
  (SELECT count(*) FROM public.get_social_conversation_list(
     '65300000-eeee-0000-0000-000000000653'::uuid,
     '65300000-eeec-0000-0000-000000000653'::uuid)
    WHERE contact_external_id = 'IG-E1'),
  1::bigint,
  '(D9) e a conversa SEM vínculo continua aparecendo — o recorte só existe com a política ligada');


-- ===========================================================================
-- (D10) Os gates de tenancy continuam de pé
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT * FROM public.get_social_conversation_list(
       '65300000-dddd-0000-0000-000000000653'::uuid,
       '65300000-cccc-0000-0000-000000000653'::uuid) $$,
  '42501',
  NULL,
  '(D10) membro da org E pedindo a caixa da org D continua levando 42501');

SELECT * FROM finish();
ROLLBACK;

-- supabase/tests/caixa_unificada_lista_por_conjunto_test.sql
--
-- SCRUM-657 (subtarefa de SCRUM-649 / épico SCRUM-648) — pgTAP das três funções
-- criadas por `20270921000000_caixa_unificada_lista_por_conjunto.sql`:
--
--   public.whatsapp_readable_instance_ids(uuid, uuid[])
--   public.get_whatsapp_conversation_list_multi(18 args)
--   public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer,
--                                                        timestamptz, uuid, text)
--
-- e as três policies de ESCRITA de `whatsapp_instance_allowed_members`, que a
-- mesma migration fecha para admin da org — sem isso a interseção de acesso é
-- auto-serviço: o membro se põe na lista da caixa proibida com um POST.
--
-- Spec: `.specs/features/2026-09-03-caixa-de-entrada-unificada.md`
--
-- Run:
--   pg_prove -d "$DATABASE_URL" supabase/tests/caixa_unificada_lista_por_conjunto_test.sql
-- ou, com o resto da suíte:
--   bash supabase/tests/run.sh
--
-- Asserts:
--   (S) estrutura e grants das TRÊS funções novas, incluindo que `instance_id`
--       é a primeira coluna de saída das duas listas — sem ela a linha não diz
--       de qual caixa veio, que é a razão de a fatia existir
--   (W) a lista do Chip, por conjunto:
--       W1–W2   conjunto NULO e conjunto VAZIO significam "todas as que eu
--               posso ler", não "nenhuma"
--       W3–W5   pedir uma caixa PROIBIDA devolve as demais, sem erro
--       W6–W7   pedir SÓ caixas proibidas devolve VAZIO, não erro de autorização
--       W8–W10  caixa de OUTRA organization nunca entra, nem misturada nem sozinha
--       W11–W14 o limite recorta por recência do CONJUNTO, não por caixa
--       W15–W17 cada linha traz a Instance de ORIGEM, e o mesmo telefone em duas
--               caixas são DUAS conversas
--       W18–W20 caixa sem lista de membros é da organization inteira; com lista,
--               só de quem está nela — nos dois sentidos
--       W21–W22 admin vê tudo da org; master em shadow também
--       W23–W25 a não-lida é contada no chip da PRÓPRIA caixa, e a leitura de
--               uma caixa não zera o contador da outra
--       W26–W27 `chat_restrict_to_owner`: CONTROLE POSITIVO DOS DOIS LADOS
--       W28     organization alheia continua sendo 42501
--       W29–W31 PAGINAÇÃO com EMPATE de last_message_time: o cursor composto
--               não perde conversa na borda da página, e o cursor parcial
--               REPETE em vez de perder
--   (P) as policies de escrita da allowlist exigem admin da org — a tabela que
--       o gate consulta não pode ser gravável por quem o gate exclui
--   (O) a lista do Canal Oficial, mesmas fronteiras
--   (R) RETROCOMPATIBILIDADE: as funções ANTIGAS respondem exatamente como
--       antes — mesma assinatura, uma só sobrecarga, mesmos grants, mesmas
--       recusas (`instance required`, `instance not in org`) e mesmas contagens
--
-- Rodado como role `authenticated` COM claims, nunca como superuser: `postgres`
-- bypassa RLS e transformaria todo assert de isolamento em falso verde, e
-- `SET ROLE` sem claims não testa nada — `auth.uid()` sairia nulo, nenhuma
-- guarda casaria e a asserção passaria por não ter rodado.
--
-- ⚠️ Toda asserção NEGATIVA desta suíte tem uma POSITIVA ao lado. Lista vazia
--    passa por segura sendo bug: foi assim que o furo do isolamento sobreviveu
--    no caminho social. Onde se afirma "não vê", afirma-se também "quem pode,
--    vê" — e onde se afirma "sumiu por causa do limite", afirma-se que com
--    limite maior a mesma linha volta.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(81);

-- ===========================================================================
-- Fixture
--
-- Três organizations:
--
--   A — `chat_restrict_to_owner = false`. É onde mora o conjunto de caixas.
--       A1 "Comercial"  — SEM linha em whatsapp_instance_allowed_members,
--                         logo aberta à organization inteira.
--       A2 "Suporte"    — COM lista: só o `membro`.
--       A3 "Diretoria"  — COM lista: só o `outro`.
--   B — existe só para provar que caixa de outra org nunca entra.
--   C — `chat_restrict_to_owner = true`, com responsável e não-responsável.
--       É o único lugar onde o recorte por dono é exercitado: medido em
--       produção, as duas orgs que têm a política ligada hoje (Goletric
--       Perdizes e Goletric Pinheiros) têm ZERO whatsapp_instances, então este
--       bloco não tem cobertura viva nenhuma fora daqui.
--
-- Pessoas:
--   membro  — org A, role `member`, na lista da A2
--   outro   — org A, role `member`, na lista da A3
--   admin   — org A, role `admin` (bypass por is_org_admin)
--   master  — EM SHADOW: não é team_member de organization nenhuma
--   b       — org B
--   cresp   — org C, responsável pelo lead
--   coutro  — org C, mesma org, sem responsabilidade e sem leads.view_*
--
-- ⚠️ `session_replication_role = replica` desliga os triggers na montagem:
--    `enforce_seat_limit` em team_members chama `assert_org_access`, que nega
--    porque ainda não há usuário autenticado.
--
-- ⚠️ Volta para `origin` ANTES das mensagens, e isso é load-bearing por DOIS
--    motivos: `trg_normalize_whatsapp_message_phone` é quem preenche
--    `normalized_phone`, e `trg_whatsapp_conversation_summary` é quem escreve
--    `whatsapp_conversation_summary` — a tabela que a RPC lê. Montar as
--    mensagens com os triggers desligados deixaria a lista VAZIA e a suíte
--    inteira passaria por não ter medido nada.
--
-- ⚠️ `role` é `member`, não `membro`. O enum `app_role` é
--    {admin,sdr,closer,agency,bdr,cliente,member}; o CLAUDE.md do repo diz
--    'membro' e está errado — valor inexistente aborta a montagem.
--
-- ⚠️ Nenhum telefone normalizado é digitado à mão em lugar nenhum: sempre
--    `public.normalize_brazilian_phone(...)`, a mesma função do trigger. Se a
--    normalização mudar, o teste acusa em vez de mentir.
--
-- ⚠️ As Instances nascem com `phone_number` NULO de propósito: assim
--    `whatsapp_chip_instance_ids` devolve o singleton e chip = Instance 1:1,
--    o que torna as contagens determinísticas. O comportamento de chip com
--    histórico já é coberto por whatsapp_instance_reap_queue_test.sql.
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, aud, role)
VALUES
  ('64900000-0001-0000-0000-000000000649', 'membro@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('64900000-0002-0000-0000-000000000649', 'outro@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('64900000-0003-0000-0000-000000000649', 'admin@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('64900000-0004-0000-0000-000000000649', 'master@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('64900000-0005-0000-0000-000000000649', 'b@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('64900000-0006-0000-0000-000000000649', 'cresp@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('64900000-0007-0000-0000-000000000649', 'coutro@unificada.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- O master NÃO ganha linha em team_members. É esse o caso que importa: o
-- bypass tem que sair de is_master_user()/is_org_admin(), nunca de um id de
-- team_member — o master/gestor virtual do front tem id SINTÉTICO
-- (`master-virtual-*`, ADR-0021) que não existe no banco.
INSERT INTO master_users (user_id, is_active)
VALUES ('64900000-0004-0000-0000-000000000649', true)
ON CONFLICT DO NOTHING;

INSERT INTO organizations (id, name, slug, chat_restrict_to_owner)
VALUES
  ('64900000-aaaa-0000-0000-000000000649', 'Org A — Caixa Unificada', 'org-a-unificada-649', false),
  ('64900000-bbbb-0000-0000-000000000649', 'Org B — Caixa Unificada', 'org-b-unificada-649', false),
  ('64900000-cccc-0000-0000-000000000649', 'Org C — Caixa Unificada', 'org-c-unificada-649', true);

INSERT INTO team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('64900000-a001-0000-0000-000000000649', '64900000-aaaa-0000-0000-000000000649',
   '64900000-0001-0000-0000-000000000649', 'Membro A', 'member', true),
  ('64900000-a002-0000-0000-000000000649', '64900000-aaaa-0000-0000-000000000649',
   '64900000-0002-0000-0000-000000000649', 'Outro A', 'member', true),
  ('64900000-a003-0000-0000-000000000649', '64900000-aaaa-0000-0000-000000000649',
   '64900000-0003-0000-0000-000000000649', 'Admin A', 'admin', true),
  ('64900000-b001-0000-0000-000000000649', '64900000-bbbb-0000-0000-000000000649',
   '64900000-0005-0000-0000-000000000649', 'Membro B', 'member', true),
  ('64900000-c001-0000-0000-000000000649', '64900000-cccc-0000-0000-000000000649',
   '64900000-0006-0000-0000-000000000649', 'Responsável C', 'member', true),
  ('64900000-c002-0000-0000-000000000649', '64900000-cccc-0000-0000-000000000649',
   '64900000-0007-0000-0000-000000000649', 'Outro C', 'member', true);

INSERT INTO whatsapp_instances (id, organization_id, instance_name, status)
VALUES
  ('64900000-1111-0000-0000-000000000649', '64900000-aaaa-0000-0000-000000000649', 'A1 Comercial (aberta)',   'connected'),
  ('64900000-2222-0000-0000-000000000649', '64900000-aaaa-0000-0000-000000000649', 'A2 Suporte (lista)',      'connected'),
  ('64900000-3333-0000-0000-000000000649', '64900000-aaaa-0000-0000-000000000649', 'A3 Diretoria (lista)',    'connected'),
  ('64900000-b1b1-0000-0000-000000000649', '64900000-bbbb-0000-0000-000000000649', 'B1 da outra org',         'connected'),
  ('64900000-c1c1-0000-0000-000000000649', '64900000-cccc-0000-0000-000000000649', 'C1 org com isolamento',   'connected');

-- A1 fica DE FORA desta tabela de propósito: "vazio = todos da org podem
-- responder" é o COMMENT da própria tabela, e é a regra que a função tem que
-- reproduzir. A2 e A3 têm lista, e as listas são DISJUNTAS.
INSERT INTO whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id)
VALUES
  ('64900000-2222-0000-0000-000000000649', '64900000-a001-0000-0000-000000000649'),
  ('64900000-3333-0000-0000-000000000649', '64900000-a002-0000-0000-000000000649');

-- Org C: o lead TEM responsável. É o eixo do isolamento por dono.
-- `normalized_phone` é gravada explicitamente porque os triggers estão
-- desligados aqui — e é exatamente a coluna que o bloco de isolamento consulta.
INSERT INTO leads (id, organization_id, name, phone, normalized_phone,
                   sale_responsible_id)
VALUES
  ('64900000-1ead-0000-0000-000000000649', '64900000-cccc-0000-0000-000000000649',
   'Cliente da Org C', '(51) 99979-7732',
   public.normalize_brazilian_phone('5551999797732'),
   '64900000-c001-0000-0000-000000000649');

-- Triggers de volta: daqui para baixo é a PORTA REAL. `normalized_phone` e
-- `whatsapp_conversation_summary` saem dos triggers, não da mão.
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Mensagens do Chip.
--
-- Recência GLOBAL, do mais novo para o mais velho:
--   A3 / P4  (t-5min)   ← a mais recente de todas, e o `membro` não pode lê-la
--   A1 / P1  (t-10min)
--   A1 / P2  (t-20min)
--   A2 / P3  (t-30min)
--   A2 / P1  (t-40min)
--
-- P1 fala com DUAS caixas. São duas Conversas do Lead distintas, não uma —
-- medido na Alamaster: colapsar por telefone através de caixas apagaria 4.453
-- conversas reais da tela, sem sinal nenhum.
--
-- A geometria de tempo acima é o que separa limite GLOBAL de limite POR CAIXA:
-- as duas conversas mais recentes de {A1, A2} estão AMBAS na A1.
-- ---------------------------------------------------------------------------
INSERT INTO whatsapp_messages
  (organization_id, instance_id, message_id, remote_jid, phone_number,
   direction, content, "timestamp")
VALUES
  ('64900000-aaaa-0000-0000-000000000649', '64900000-1111-0000-0000-000000000649',
   'unif-a1-p1', '5511911111111@s.whatsapp.net', '5511911111111',
   'incoming', 'conversa P1 na caixa A1', now() - interval '10 minutes'),
  ('64900000-aaaa-0000-0000-000000000649', '64900000-1111-0000-0000-000000000649',
   'unif-a1-p2', '5511922222222@s.whatsapp.net', '5511922222222',
   'incoming', 'conversa P2 na caixa A1', now() - interval '20 minutes'),
  ('64900000-aaaa-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649',
   'unif-a2-p3', '5511933333333@s.whatsapp.net', '5511933333333',
   'incoming', 'conversa P3 na caixa A2', now() - interval '30 minutes'),
  ('64900000-aaaa-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649',
   'unif-a2-p1', '5511911111111@s.whatsapp.net', '5511911111111',
   'incoming', 'conversa P1 na caixa A2', now() - interval '40 minutes'),
  ('64900000-aaaa-0000-0000-000000000649', '64900000-3333-0000-0000-000000000649',
   'unif-a3-p4', '5511944444444@s.whatsapp.net', '5511944444444',
   'incoming', 'conversa P4 na caixa A3', now() - interval '5 minutes'),
  ('64900000-bbbb-0000-0000-000000000649', '64900000-b1b1-0000-0000-000000000649',
   'unif-b1', '5511955555555@s.whatsapp.net', '5511955555555',
   'incoming', 'conversa da org B', now() - interval '15 minutes'),
  ('64900000-cccc-0000-0000-000000000649', '64900000-c1c1-0000-0000-000000000649',
   'unif-c1', '5551999797732@s.whatsapp.net', '5551999797732',
   'incoming', 'conversa do lead com dono', now() - interval '15 minutes');

-- ---------------------------------------------------------------------------
-- Mensagens do Canal Oficial, nas MESMAS Instances — a interseção de acesso é
-- a mesma função dos dois lados, e reusar as caixas é o que prova isso.
-- `contact_external_id` é CRU, como o fornecedor manda.
-- ---------------------------------------------------------------------------
INSERT INTO channel_messages (organization_id, channel, instance_id, external_id,
                              contact_external_id, sender_name, direction,
                              content, "timestamp")
VALUES
  ('64900000-aaaa-0000-0000-000000000649', 'whatsapp', '64900000-1111-0000-0000-000000000649',
   'unif-ch-a1', '5511911111111', 'Contato P1', 'incoming',
   'oficial P1 na caixa A1', now() - interval '10 minutes'),
  ('64900000-aaaa-0000-0000-000000000649', 'whatsapp', '64900000-2222-0000-0000-000000000649',
   'unif-ch-a2', '5511911111111', 'Contato P1', 'incoming',
   'oficial P1 na caixa A2', now() - interval '40 minutes'),
  ('64900000-aaaa-0000-0000-000000000649', 'whatsapp', '64900000-3333-0000-0000-000000000649',
   'unif-ch-a3', '5511944444444', 'Contato P4', 'incoming',
   'oficial P4 na caixa A3', now() - interval '5 minutes'),
  ('64900000-bbbb-0000-0000-000000000649', 'whatsapp', '64900000-b1b1-0000-0000-000000000649',
   'unif-ch-b1', '5511955555555', 'Contato da org B', 'incoming',
   'oficial da org B', now() - interval '15 minutes'),
  ('64900000-cccc-0000-0000-000000000649', 'whatsapp', '64900000-c1c1-0000-0000-000000000649',
   'unif-ch-c1', '5551999797732', 'Cliente da Org C', 'incoming',
   'oficial do lead com dono', now() - interval '15 minutes');


-- ===========================================================================
-- (S) Estrutura e grants
--
-- Função nova nasce com EXECUTE para PUBLIC (default do Postgres) e o Supabase
-- ainda tem default privilege para `anon` no schema `public`. Não houve DROP
-- aqui, então o risco não é grant perdido — é grant que nunca foi tirado.
-- ===========================================================================

-- --- whatsapp_readable_instance_ids ---------------------------------------
SELECT is(
  (SELECT oidvectortypes(p.proargtypes)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'whatsapp_readable_instance_ids'),
  'uuid, uuid[]',
  '(S) whatsapp_readable_instance_ids(uuid, uuid[]) existe com essa assinatura');

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'whatsapp_readable_instance_ids'),
  '(S) é SECURITY DEFINER — a guarda tem que responder o mesmo para todo chamador, '
  'e continuar respondendo a verdade no dia em que a policy de SELECT da allowlist '
  'for endurecida: ali "não li lista nenhuma" vira "não existe lista", que LIBERA');

SELECT ok(
  (SELECT p.proconfig::text LIKE '%search_path=public%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'whatsapp_readable_instance_ids'),
  '(S) search_path fixado');

SELECT ok(
  has_function_privilege('authenticated',
    'public.whatsapp_readable_instance_ids(uuid, uuid[])', 'EXECUTE'),
  '(S) authenticated executa whatsapp_readable_instance_ids');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.whatsapp_readable_instance_ids(uuid, uuid[])', 'EXECUTE'),
  '(S) anon NÃO executa whatsapp_readable_instance_ids');

-- PUBLIC é o grantee 0 em aclexplode. `proacl IS NOT NULL` vai junto de
-- propósito: ACL nula significa "nunca ninguém mexeu", e o DEFAULT do Postgres
-- para função é EXECUTE a PUBLIC — nulo passaria por fechado sendo o aberto.
SELECT ok(
  (SELECT p.proacl IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'whatsapp_readable_instance_ids'),
  '(S) PUBLIC não tem EXECUTE em whatsapp_readable_instance_ids');

-- `service_role` FICA DE FORA das três, e é decisão, não esquecimento: o gate
-- de org recusa esse papel antes de qualquer leitura. MEDIDO em produção com
-- `SET ROLE service_role` e claims nulas — o contexto de uma edge function:
-- `get_my_organization_ids()` devolve 0 linhas e `is_master_user()` devolve
-- false, então o gate levanta 42501. Grant sem escape faria a primeira edge
-- function depurar permissão, que está certa, em vez do gate, que é a causa.
-- (`whatsapp_chip_instance_ids` tem o escape; estas, de propósito, não.)
SELECT ok(
  NOT has_function_privilege('service_role',
    'public.whatsapp_readable_instance_ids(uuid, uuid[])', 'EXECUTE'),
  '(S) service_role NÃO executa whatsapp_readable_instance_ids — o gate o recusaria '
  'com 42501 de qualquer forma, e grant decorativo é pista falsa');

-- --- get_whatsapp_conversation_list_multi ----------------------------------
SELECT is(
  (SELECT oidvectortypes(p.proargtypes)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list_multi'),
  'uuid, uuid[], integer, timestamp with time zone, uuid[], text[], uuid[], text[], uuid, boolean, text, boolean, boolean, boolean, text, boolean, uuid, text',
  '(S) get_whatsapp_conversation_list_multi tem os 18 argumentos: os 16 da irmã, com '
  'p_instances uuid[] no lugar de p_instance uuid, MAIS p_before_box e p_before_phone — '
  'o cursor composto sem o qual a paginação sobre o conjunto perde conversa em empate');

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list_multi'),
  '(S) get_whatsapp_conversation_list_multi é SECURITY DEFINER — a RLS não recorta '
  'aqui dentro, quem recorta são os gates e o bloco de isolamento explícito');

SELECT ok(
  (SELECT p.proconfig::text LIKE '%search_path=public%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list_multi'),
  '(S) search_path fixado');

SELECT ok(
  has_function_privilege('authenticated',
    'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamptz,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)',
    'EXECUTE'),
  '(S) authenticated executa get_whatsapp_conversation_list_multi');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamptz,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)',
    'EXECUTE'),
  '(S) anon NÃO executa get_whatsapp_conversation_list_multi');

-- PUBLIC é o grantee 0 em aclexplode. `proacl IS NOT NULL` vai junto de
-- propósito: ACL nula significa "nunca ninguém mexeu", e o DEFAULT do Postgres
-- para função é EXECUTE a PUBLIC — nulo passaria por fechado sendo o aberto.
SELECT ok(
  (SELECT p.proacl IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list_multi'),
  '(S) PUBLIC não tem EXECUTE em get_whatsapp_conversation_list_multi');

SELECT ok(
  NOT has_function_privilege('service_role',
    'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamptz,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)',
    'EXECUTE'),
  '(S) service_role NÃO executa get_whatsapp_conversation_list_multi');

-- A coluna que a fatia inteira existe para entregar. Sem ela a lista mistura
-- caixas e a linha não diz por qual número responder.
SELECT is(
  (SELECT (array_agg(a.nm ORDER BY a.ord))[1]
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(nm, md, ord)
    WHERE n.nspname = 'public'
      AND p.proname = 'get_whatsapp_conversation_list_multi'
      AND a.md = 't'),
  'instance_id',
  '(S) instance_id é a PRIMEIRA coluna de saída — a linha diz de qual caixa veio');

-- --- get_official_whatsapp_conversation_list_multi -------------------------
SELECT is(
  (SELECT oidvectortypes(p.proargtypes)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list_multi'),
  'uuid, uuid[], integer, timestamp with time zone, uuid, text',
  '(S) get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz, '
  'uuid, text) existe — os dois últimos são o cursor composto');

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list_multi'),
  '(S) get_official_whatsapp_conversation_list_multi é SECURITY DEFINER');

SELECT ok(
  (SELECT p.proconfig::text LIKE '%search_path=public%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list_multi'),
  '(S) search_path fixado');

SELECT ok(
  has_function_privilege('authenticated',
    'public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz, uuid, text)', 'EXECUTE'),
  '(S) authenticated executa get_official_whatsapp_conversation_list_multi');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz, uuid, text)', 'EXECUTE'),
  '(S) anon NÃO executa get_official_whatsapp_conversation_list_multi');

-- PUBLIC é o grantee 0 em aclexplode. `proacl IS NOT NULL` vai junto de
-- propósito: ACL nula significa "nunca ninguém mexeu", e o DEFAULT do Postgres
-- para função é EXECUTE a PUBLIC — nulo passaria por fechado sendo o aberto.
SELECT ok(
  (SELECT p.proacl IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list_multi'),
  '(S) PUBLIC não tem EXECUTE em get_official_whatsapp_conversation_list_multi');

SELECT ok(
  NOT has_function_privilege('service_role',
    'public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz, uuid, text)',
    'EXECUTE'),
  '(S) service_role NÃO executa get_official_whatsapp_conversation_list_multi');

SELECT is(
  (SELECT (array_agg(a.nm ORDER BY a.ord))[1]
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(nm, md, ord)
    WHERE n.nspname = 'public'
      AND p.proname = 'get_official_whatsapp_conversation_list_multi'
      AND a.md = 't'),
  'instance_id',
  '(S) instance_id é a PRIMEIRA coluna de saída também no Canal Oficial');


-- ===========================================================================
-- (W) A lista do Chip, por conjunto — como `membro`
--
-- `membro` lê A1 (aberta) e A2 (lista contém ele). NÃO lê A3.
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0001-0000-0000-000000000649","role":"authenticated"}', true);

-- --- W1–W2: conjunto vazio/nulo = "todas as que eu posso ler" --------------
-- CONTROLE POSITIVO de toda a suíte: se este assert der 0, os asserts negativos
-- abaixo passariam por motivo errado.
SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])),
  4::bigint,
  '(W1) CONTROLE POSITIVO: conjunto NULO devolve as 4 conversas das caixas que a pessoa pode ler (A1 e A2), não zero');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY[]::uuid[])),
  4::bigint,
  '(W2) conjunto VAZIO significa a mesma coisa que nulo — é assim que a tela abre antes de marcar nada');

-- --- W3–W5: pedir uma caixa proibida devolve as demais ---------------------
SELECT lives_ok(
  $$ SELECT * FROM public.get_whatsapp_conversation_list_multi(
       p_org => '64900000-aaaa-0000-0000-000000000649',
       p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                            '64900000-3333-0000-0000-000000000649']::uuid[]) $$,
  '(W3) pedir uma caixa proibida junto com uma permitida NÃO levanta erro — '
  'o cliente não é autoridade sobre o conjunto, a função é');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-3333-0000-0000-000000000649']::uuid[])),
  2::bigint,
  '(W4) …e devolve as conversas da caixa PERMITIDA (A1: 2 conversas)');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-3333-0000-0000-000000000649']::uuid[])
    WHERE instance_id = '64900000-3333-0000-0000-000000000649'),
  0::bigint,
  '(W5) …e NENHUMA linha da caixa proibida (A3), mesmo tendo sido pedida explicitamente');

-- --- W6–W7: só caixas proibidas = vazio, não erro -------------------------
-- Erro aqui envenenaria uma seleção salva depois de uma mudança de permissão:
-- a tela quebraria em vez de aparecer vazia.
SELECT lives_ok(
  $$ SELECT * FROM public.get_whatsapp_conversation_list_multi(
       p_org => '64900000-aaaa-0000-0000-000000000649',
       p_instances => ARRAY['64900000-3333-0000-0000-000000000649']::uuid[]) $$,
  '(W6) pedir SÓ caixas proibidas não vaza erro de autorização');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-3333-0000-0000-000000000649']::uuid[])),
  0::bigint,
  '(W7) …devolve VAZIO. E o W1 acima é quem prova que este vazio é recorte, não função quebrada');

-- --- W8–W10: caixa de outra organization nunca entra ----------------------
SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-b1b1-0000-0000-000000000649']::uuid[])),
  2::bigint,
  '(W8) caixa de OUTRA org pedida junto não derruba a lista das válidas');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-b1b1-0000-0000-000000000649']::uuid[])
    WHERE instance_id = '64900000-b1b1-0000-0000-000000000649'),
  0::bigint,
  '(W9) …e a caixa da org B NÃO entra, mesmo pedida explicitamente');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-b1b1-0000-0000-000000000649']::uuid[])),
  0::bigint,
  '(W10) pedir SÓ a caixa da org B devolve vazio — o uuid não é senha');

-- --- W11–W14: o limite é GLOBAL sobre o conjunto, não por caixa -----------
--
-- Geometria: as duas conversas mais recentes de {A1, A2} estão AMBAS na A1
-- (t-10 e t-20); a mais recente da A2 é t-30. Com limite 2:
--   • limite GLOBAL  → 2 linhas, as duas da A1;
--   • limite POR CAIXA (2 em cada) → 4 linhas, com a A2 dentro;
--   • limite RATEADO (1 por caixa) → 2 linhas, uma de cada.
-- Os três resultados são distinguíveis, e é por isso que a geometria é assim.
SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 2)),
  2::bigint,
  '(W11) limite 2 sobre DUAS caixas devolve 2 linhas no total, não 2 por caixa');

SELECT is(
  (SELECT count(DISTINCT instance_id) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 2)),
  1::bigint,
  '(W12) …e a página inteira pode sair de UMA caixa só, porque a ordenação é por recência do CONJUNTO');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 2)
    WHERE normalized_phone = public.normalize_brazilian_phone('5511933333333')),
  0::bigint,
  '(W13) a conversa mais recente da A2 fica FORA da página de 2 — ela é a 3ª do conjunto');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649',
                          '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 10)
    WHERE normalized_phone = public.normalize_brazilian_phone('5511933333333')),
  1::bigint,
  '(W14) CONTROLE POSITIVO do limite: com limite 10 a MESMA conversa volta — '
  'ela sumiu por paginação, não por recorte de acesso');

-- --- W15–W17: cada linha traz a Instance de origem -------------------------
SELECT is(
  (SELECT instance_id FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511933333333')),
  '64900000-2222-0000-0000-000000000649'::uuid,
  '(W15) a linha traz a caixa de ORIGEM correta (P3 veio da A2)');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511911111111')),
  2::bigint,
  '(W16) o MESMO telefone falando com duas caixas são DUAS conversas, não uma — '
  'o DISTINCT ON é por (chip, telefone) e fundi-las apagaria conversa real');

SELECT is(
  (SELECT count(DISTINCT instance_id) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511911111111')),
  2::bigint,
  '(W17) …e cada uma das duas aponta para a SUA caixa, não as duas para a mesma');

-- --- W18–W20: lista de membros permitidos, nos dois sentidos ---------------
-- `outro` lê A1 (aberta a toda a org) e A3 (lista contém ele). NÃO lê A2.
-- As listas de A2 e A3 são disjuntas de propósito: sem isso, "não vê" e "vê"
-- não seriam separáveis.
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0002-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])),
  3::bigint,
  '(W18) outro membro da MESMA org vê um conjunto DIFERENTE: A1 (aberta) + A3 (lista dele) = 3 conversas');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511933333333')),
  0::bigint,
  '(W19) caixa COM lista da qual ele está fora (A2) não aparece para ele');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511944444444')),
  1::bigint,
  '(W20) CONTROLE POSITIVO: caixa COM lista da qual ele PARTICIPA (A3) aparece — '
  'e o W5 acima prova que a mesma A3 não aparece para quem está fora dela');

-- --- W21–W22: admin e master ----------------------------------------------
-- Medido na Alamaster: pela regra de lista pura, o admin veria ZERO caixas
-- (as 57 têm lista e ele não está em nenhuma). O bypass é load-bearing.
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0003-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])),
  5::bigint,
  '(W21) admin da org vê TODAS as caixas dela (A1+A2+A3 = 5 conversas), inclusive as que têm lista sem ele');

SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0004-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])),
  5::bigint,
  '(W22) MASTER EM SHADOW — sem linha em team_members de org nenhuma — vê tudo. '
  'O bypass sai de is_master_user(), nunca de um id de team_member');

-- --- W23–W25: a não-lida é do chip da PRÓPRIA caixa ------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0001-0000-0000-000000000649","role":"authenticated"}', true);

-- P1 tem UMA mensagem recebida em cada caixa. Se a contagem usasse o achatado
-- de todos os chips, as DUAS linhas mostrariam 2. Medido em produção no
-- telefone 21980295482 da Alamaster: era 19 nas duas, e a verdade era 19 e 0.
SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511911111111')
      AND unread_count = 1),
  2::bigint,
  '(W23) cada linha de P1 conta 1 não-lida (a da SUA caixa), não 2 — o badge não soma caixas alheias');

SET LOCAL role postgres;
INSERT INTO conversation_read_state (organization_id, user_id, conversation_key, last_read_at)
VALUES ('64900000-aaaa-0000-0000-000000000649', '64900000-0001-0000-0000-000000000649',
        'whatsapp:64900000-1111-0000-0000-000000000649:'
          || public.normalize_brazilian_phone('5511911111111'),
        now());
SET LOCAL role authenticated;

SELECT is(
  (SELECT unread_count FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511911111111')
      AND instance_id = '64900000-1111-0000-0000-000000000649'),
  0,
  '(W24) ler na caixa A1 zera o contador DA A1');

SELECT is(
  (SELECT unread_count FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[])
    WHERE normalized_phone = public.normalize_brazilian_phone('5511911111111')
      AND instance_id = '64900000-2222-0000-0000-000000000649'),
  1,
  '(W25) …e NÃO zera o da A2. A chave de leitura é por caixa, e o read_state agrupa por caixa');

-- --- W26–W27: chat_restrict_to_owner, os DOIS lados ------------------------
--
-- Esta função é SECURITY DEFINER: a RLS de whatsapp_messages não se aplica
-- aqui dentro. Sem o bloco de isolamento explícito, a policy fica DECORATIVA —
-- a tabela fecha e a LISTA, que é o que o usuário vê, continua mostrando tudo.
--
-- Os dois lados são obrigatórios. Um "não vê" sozinho passaria verde também
-- com a função quebrada, e foi assim que o furo equivalente sobreviveu no
-- caminho social.
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0007-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-cccc-0000-0000-000000000649',
     p_instances => NULL::uuid[])),
  0::bigint,
  '(W26) política LIGADA: quem NÃO é responsável pelo lead não vê a conversa dele');

SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0006-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-cccc-0000-0000-000000000649',
     p_instances => NULL::uuid[])),
  1::bigint,
  '(W27) CONTROLE POSITIVO do isolamento: o RESPONSÁVEL VÊ a conversa dele — '
  'mesma caixa, mesma conversa, mesma chamada, pessoa diferente');

-- --- W28: o gate de organization continua sendo erro ----------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0001-0000-0000-000000000649","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT * FROM public.get_whatsapp_conversation_list_multi(
       p_org => '64900000-bbbb-0000-0000-000000000649', p_instances => NULL::uuid[]) $$,
  '42501', 'forbidden: org not accessible',
  '(W28) pedir org ALHEIA é recusado com ERRO, não com lista vazia — '
  'caixa proibida é vazio, org proibida é 42501');


-- ===========================================================================
-- (O) A lista do Canal Oficial, por conjunto
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649', p_instances => NULL::uuid[])),
  2::bigint,
  '(O1) CONTROLE POSITIVO: o mesmo contato em duas caixas legíveis são DUAS linhas');

SELECT is(
  (SELECT count(DISTINCT instance_id) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649', p_instances => NULL::uuid[])),
  2::bigint,
  '(O2) …e cada uma aponta para a SUA caixa — o DISTINCT ON é por (instance_id, contato)');

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649', p_instances => NULL::uuid[])
    WHERE instance_id = '64900000-3333-0000-0000-000000000649'),
  0::bigint,
  '(O3) a caixa que o usuário não pode ler (A3) fica fora, mesmo tendo a conversa mais recente da org');

SELECT lives_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list_multi(
       p_org => '64900000-aaaa-0000-0000-000000000649',
       p_instances => ARRAY['64900000-3333-0000-0000-000000000649']::uuid[]) $$,
  '(O4) pedir só a caixa proibida não vaza erro de autorização');

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-3333-0000-0000-000000000649']::uuid[])),
  0::bigint,
  '(O5) …devolve vazio');

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-b1b1-0000-0000-000000000649']::uuid[])),
  0::bigint,
  '(O6) caixa de outra organization nunca entra, mesmo pedida explicitamente');

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[], p_limit => 1)),
  1::bigint,
  '(O7) o limite é GLOBAL sobre o conjunto: 1 é 1 no total, não 1 por caixa');

SELECT is(
  (SELECT instance_id FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => NULL::uuid[], p_limit => 1)),
  '64900000-1111-0000-0000-000000000649'::uuid,
  '(O8) …e a linha que sobra é a mais recente do CONJUNTO (A1, t-10min), não a primeira caixa da lista');

SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0007-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-cccc-0000-0000-000000000649', p_instances => NULL::uuid[])),
  0::bigint,
  '(O9) política LIGADA: o não-responsável não vê a conversa no Canal Oficial');

SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0006-0000-0000-000000000649","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-cccc-0000-0000-000000000649', p_instances => NULL::uuid[])),
  1::bigint,
  '(O10) CONTROLE POSITIVO: o responsável VÊ — can_see_chat_scope continua por conversa');

SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0001-0000-0000-000000000649","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list_multi(
       p_org => '64900000-bbbb-0000-0000-000000000649', p_instances => NULL::uuid[]) $$,
  '42501', 'forbidden: org not accessible',
  '(O11) org alheia é 42501 também no Canal Oficial');


-- ===========================================================================
-- (R) RETROCOMPATIBILIDADE
--
-- A decisão D2 é "funções IRMÃS, não alteração das atuais". A migration não
-- tem DROP nenhum — este bloco é quem prova isso, e é o que impede que uma
-- futura "unificação" troque a assinatura viva por baixo do front, da bolha,
-- da command palette e do mobile, que seguem chamando as antigas.
-- ===========================================================================
SELECT is(
  (SELECT oidvectortypes(p.proargtypes)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list'),
  'uuid, uuid, integer, timestamp with time zone, uuid[], text[], uuid[], text[], uuid, boolean, text, boolean, boolean, boolean, text, boolean',
  '(R1) a assinatura ANTIGA de get_whatsapp_conversation_list está intacta — p_instance uuid, não uuid[]');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list'),
  1::bigint,
  '(R2) UMA sobrecarga só — duas devolveriam PGRST203 na tela, que já aconteceu nesta função');

SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list(
     '64900000-aaaa-0000-0000-000000000649', '64900000-1111-0000-0000-000000000649')),
  2::bigint,
  '(R3) a função antiga responde igual: as 2 conversas da caixa pedida');

SELECT throws_ok(
  $$ SELECT * FROM public.get_whatsapp_conversation_list(
       '64900000-aaaa-0000-0000-000000000649', NULL) $$,
  '22023', 'instance required',
  '(R4) a antiga CONTINUA exigindo uma Instance — aceitar nulo ali era mudar o contrato dela, não o da irmã');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.get_whatsapp_conversation_list(uuid,uuid,integer,timestamptz,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean)',
    'EXECUTE'),
  '(R5) os grants da antiga seguem fechados para anon — a migration não a tocou, e este assert é quem verifica');

SELECT is(
  (SELECT oidvectortypes(p.proargtypes)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list'),
  'uuid, uuid, integer, timestamp with time zone',
  '(R6) a assinatura ANTIGA de get_official_whatsapp_conversation_list está intacta');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_official_whatsapp_conversation_list'),
  1::bigint,
  '(R7) UMA sobrecarga só no Canal Oficial');

SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list(
     '64900000-aaaa-0000-0000-000000000649', '64900000-1111-0000-0000-000000000649')),
  1::bigint,
  '(R8) a antiga do Canal Oficial responde igual: a conversa da caixa pedida');

SELECT throws_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list(
       '64900000-aaaa-0000-0000-000000000649', NULL) $$,
  '22023', 'instance required',
  '(R9) a antiga do Canal Oficial continua exigindo Instance');

SELECT throws_ok(
  $$ SELECT * FROM public.get_official_whatsapp_conversation_list(
       '64900000-aaaa-0000-0000-000000000649', '64900000-b1b1-0000-0000-000000000649') $$,
  '42501', 'forbidden: instance not in org',
  '(R10) a antiga continua RECUSANDO caixa de outra org com erro. A irmã nova a IGNORA '
  'em silêncio de propósito: com N caixas pedidas, uma inválida não pode derrubar as válidas');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz)', 'EXECUTE'),
  '(R11) os grants da antiga do Canal Oficial seguem fechados para anon');


-- ===========================================================================
-- (W29–W31) PAGINAÇÃO COM EMPATE — o defeito que a unificação LIGA
--
-- MEDIDO EM PRODUÇÃO EM 2026-09-03, Alamaster: 9.389 de 9.390 conversas
-- não-grupo têm `last_message_time` de SEGUNDO INTEIRO (o fornecedor manda unix
-- em segundos), sobre 8.779 instantes distintos. Simulando a rolagem inteira,
-- 50 em 50, com cursor de UMA coluna e `<` estrito:
--   • CONJUNTO das 57 caixas: 188 páginas, 9.368 de 9.390 — 22 conversas somem
--     PARA SEMPRE, em nenhuma página;
--   • UMA caixa (49437977-…, 1.700 conversas): 34 páginas, 1.700 de 1.700.
-- É a união que cria o defeito, e é esta fatia que liga o mecanismo — nenhum
-- call-site do front manda `p_before` hoje.
--
-- A geometria abaixo é a menor que reproduz isso: TRÊS conversas, sendo a 2ª e
-- a 3ª EMPATADAS em `last_message_time` e em CAIXAS DIFERENTES, com limite 2 —
-- a borda da página cai DENTRO do empate, que é exatamente o caso em que o
-- cursor de uma coluna só apaga a irmã.
--
-- ⚠️ Este bloco entra DEPOIS de (R) de propósito: ele acrescenta conversas, e
--    todos os asserts de contagem acima seriam invalidados se viesse antes.
-- ===========================================================================
SET LOCAL role postgres;

-- `now()` é fixo dentro da transação, então os dois `- interval '1 minute'`
-- produzem o MESMO instante — o empate é montado, não sorteado.
INSERT INTO whatsapp_messages
  (organization_id, instance_id, message_id, remote_jid, phone_number,
   direction, content, "timestamp")
VALUES
  ('64900000-aaaa-0000-0000-000000000649', '64900000-1111-0000-0000-000000000649',
   'unif-pag-topo', '5511988888888@s.whatsapp.net', '5511988888888',
   'incoming', 'a mais recente de todas', now() - interval '30 seconds'),
  ('64900000-aaaa-0000-0000-000000000649', '64900000-1111-0000-0000-000000000649',
   'unif-pag-empate-a1', '5511966666666@s.whatsapp.net', '5511966666666',
   'incoming', 'empatada, caixa A1', now() - interval '1 minute'),
  ('64900000-aaaa-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649',
   'unif-pag-empate-a2', '5511977777777@s.whatsapp.net', '5511977777777',
   'incoming', 'empatada, caixa A2', now() - interval '1 minute');

INSERT INTO channel_messages (organization_id, channel, instance_id, external_id,
                              contact_external_id, sender_name, direction,
                              content, "timestamp")
VALUES
  ('64900000-aaaa-0000-0000-000000000649', 'whatsapp', '64900000-1111-0000-0000-000000000649',
   'unif-ch-pag-topo', '5511988888888', 'Topo', 'incoming',
   'oficial mais recente', now() - interval '30 seconds'),
  ('64900000-aaaa-0000-0000-000000000649', 'whatsapp', '64900000-1111-0000-0000-000000000649',
   'unif-ch-pag-a1', '5511966666666', 'Empate A1', 'incoming',
   'oficial empatado A1', now() - interval '1 minute'),
  ('64900000-aaaa-0000-0000-000000000649', 'whatsapp', '64900000-2222-0000-0000-000000000649',
   'unif-ch-pag-a2', '5511977777777', 'Empate A2', 'incoming',
   'oficial empatado A2', now() - interval '1 minute');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0001-0000-0000-000000000649","role":"authenticated"}', true);

-- CONTROLE POSITIVO do bloco inteiro: sem paginação as duas empatadas EXISTEM e
-- são visíveis. Sem este assert, os dois seguintes passariam com a lista vazia.
SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 10)
    WHERE normalized_phone IN (public.normalize_brazilian_phone('5511966666666'),
                               public.normalize_brazilian_phone('5511977777777'))),
  2::bigint,
  '(W29) CONTROLE POSITIVO: as DUAS conversas empatadas aparecem numa página só, '
  'em caixas diferentes — o empate está montado e é visível');

-- O assert que pega o defeito. Página 1 com limite 2 pega a mais recente e UMA
-- das empatadas; o cursor sai da ÚLTIMA linha entregue, como o front faria.
-- Com cursor de uma coluna e `<` estrito, a irmã do empate não entra em página
-- NENHUMA: a soma das duas páginas traria 1 das 2. Com cursor composto, 2.
SELECT is(
  (WITH p1 AS (
     SELECT m.instance_id, m.normalized_phone, m.last_message_time
       FROM public.get_whatsapp_conversation_list_multi(
              p_org => '64900000-aaaa-0000-0000-000000000649',
              p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
              p_limit => 2) m
   ),
   cur AS (
     SELECT p1.last_message_time AS t, p1.instance_id AS b, p1.normalized_phone AS np
       FROM p1
      ORDER BY p1.last_message_time, p1.instance_id, p1.normalized_phone
      LIMIT 1
   ),
   p2 AS (
     SELECT m.instance_id, m.normalized_phone
       FROM cur
       CROSS JOIN LATERAL public.get_whatsapp_conversation_list_multi(
              p_org => '64900000-aaaa-0000-0000-000000000649',
              p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
              p_limit => 2,
              p_before => cur.t,
              p_before_box => cur.b,
              p_before_phone => cur.np) m
   )
   SELECT count(*)
     FROM (SELECT instance_id, normalized_phone FROM p1
           UNION ALL
           SELECT instance_id, normalized_phone FROM p2) u
    WHERE u.normalized_phone IN (public.normalize_brazilian_phone('5511966666666'),
                                 public.normalize_brazilian_phone('5511977777777'))),
  2::bigint,
  '(W30) rolar a lista misturada de 2 em 2 com o cursor COMPOSTO entrega as DUAS '
  'empatadas — uma em cada página. Com cursor de uma coluna só, a segunda some '
  'de todas as páginas, que é a mentira que a decisão D3 existe para impedir');

-- Contrato antigo: quem mandar só `p_before` não perde nada — REPETE o empate.
-- Repetir é visível e recuperável; sumir não é nenhum dos dois.
SELECT is(
  (SELECT count(*) FROM public.get_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 10,
     p_before => (SELECT m.last_message_time
                    FROM public.get_whatsapp_conversation_list_multi(
                           p_org => '64900000-aaaa-0000-0000-000000000649',
                           p_instances => ARRAY['64900000-1111-0000-0000-000000000649']::uuid[],
                           p_limit => 10) m
                   WHERE m.normalized_phone = public.normalize_brazilian_phone('5511966666666')))
    WHERE normalized_phone IN (public.normalize_brazilian_phone('5511966666666'),
                               public.normalize_brazilian_phone('5511977777777'))),
  2::bigint,
  '(W31) cursor PARCIAL (só p_before, o contrato antigo) devolve o empate INTEIRO '
  'de novo em vez de perdê-lo — a degradação escolhida é duplicar, nunca sumir');

-- --- O12–O13: a mesma paginação no Canal Oficial ---------------------------
SELECT is(
  (SELECT count(*) FROM public.get_official_whatsapp_conversation_list_multi(
     p_org => '64900000-aaaa-0000-0000-000000000649',
     p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
     p_limit => 10)
    WHERE contact_external_id IN ('5511966666666', '5511977777777')),
  2::bigint,
  '(O12) CONTROLE POSITIVO: as duas threads empatadas do Canal Oficial existem');

SELECT is(
  (WITH p1 AS (
     SELECT m.instance_id, m.contact_external_id, m.last_message_time
       FROM public.get_official_whatsapp_conversation_list_multi(
              p_org => '64900000-aaaa-0000-0000-000000000649',
              p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
              p_limit => 2) m
   ),
   cur AS (
     SELECT p1.last_message_time AS t, p1.instance_id AS i, p1.contact_external_id AS c
       FROM p1
      ORDER BY p1.last_message_time, p1.instance_id, p1.contact_external_id
      LIMIT 1
   ),
   p2 AS (
     SELECT m.instance_id, m.contact_external_id
       FROM cur
       CROSS JOIN LATERAL public.get_official_whatsapp_conversation_list_multi(
              p_org => '64900000-aaaa-0000-0000-000000000649',
              p_instances => ARRAY['64900000-1111-0000-0000-000000000649', '64900000-2222-0000-0000-000000000649']::uuid[],
              p_limit => 2,
              p_before => cur.t,
              p_before_instance => cur.i,
              p_before_contact => cur.c) m
   )
   SELECT count(*)
     FROM (SELECT instance_id, contact_external_id FROM p1
           UNION ALL
           SELECT instance_id, contact_external_id FROM p2) u
    WHERE u.contact_external_id IN ('5511966666666', '5511977777777')),
  2::bigint,
  '(O13) …e o cursor composto do Canal Oficial também entrega as duas — '
  'este lado é inerte hoje (1 Instance, 22 contatos), e é por isso que nasce fechado');


-- ===========================================================================
-- (P) A ALLOWLIST É GATE, ENTÃO A ESCRITA DELA NÃO PODE SER AUTO-SERVIÇO
--
-- MEDIDO EM PRODUÇÃO: `whatsapp.manage_instances` está `is_admin_only = false,
-- default_value = true` no catálogo, com ZERO linhas em
-- `organization_feature_defaults`, então `can_manage_whatsapp_instances()`
-- devolvia true para TODO membro ativo — e as três policies de escrita desta
-- tabela pediam só isso mais "ser team_member da org da Instance". Com
-- `authenticated` tendo INSERT/UPDATE/DELETE na tabela, a interseção D4 era
-- auto-serviço: um POST me põe na lista da caixa proibida, e um DELETE esvazia
-- a lista e faz a caixa cair no ramo "sem lista = aberta à org inteira".
--
-- Estes asserts são sobre a TABELA, não sobre a função — é lá que o gate mora.
-- ===========================================================================
-- `errcode` tipado e `errmsg` NULO de propósito: o texto da recusa de RLS é do
-- Postgres, não nosso, e casá-lo à letra amarraria a suíte à versão do servidor.
-- O que importa é o CÓDIGO — 42501, a recusa.
SELECT throws_ok(
  $$ INSERT INTO whatsapp_instance_allowed_members (whatsapp_instance_id, team_member_id)
     VALUES ('64900000-3333-0000-0000-000000000649', '64900000-a001-0000-0000-000000000649') $$,
  '42501'::char(5), NULL::text,
  '(P1) membro comum NÃO se põe na lista de uma caixa proibida — a escrita da '
  'allowlist exige admin da org, senão o gate de acesso é auto-serviço');

-- DELETE barrado por RLS não levanta erro: some do recorte e afeta ZERO linhas.
-- Por isso este assert conta linhas em vez de esperar exceção.
--
-- ⚠️ O `WITH` fica no TOPO do statement, e não dentro de um subselect do `is()`:
--    CTE que modifica dado só é aceita no nível de cima
--    ("WITH clause containing a data-modifying statement must be at the top
--    level"). `count(*)` sobre conjunto vazio ainda devolve uma linha com 0.
WITH d AS (
  DELETE FROM whatsapp_instance_allowed_members
   WHERE whatsapp_instance_id = '64900000-3333-0000-0000-000000000649'
   RETURNING 1
)
SELECT is(
  count(*),
  0::bigint,
  '(P2) …e NÃO esvazia a lista da caixa proibida, que era o outro caminho: lista '
  'vazia significa "aberta à org inteira"')
FROM d;

SELECT set_config('request.jwt.claims',
  '{"sub":"64900000-0003-0000-0000-000000000649","role":"authenticated"}', true);

WITH d AS (
  DELETE FROM whatsapp_instance_allowed_members
   WHERE whatsapp_instance_id = '64900000-3333-0000-0000-000000000649'
   RETURNING 1
)
SELECT is(
  count(*),
  1::bigint,
  '(P3) CONTROLE POSITIVO: o ADMIN da org apaga a MESMA linha. O W19 e o P2 acima '
  'provam que o gate é sobre QUEM escreve, não sobre uma linha que não existia')
FROM d;

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

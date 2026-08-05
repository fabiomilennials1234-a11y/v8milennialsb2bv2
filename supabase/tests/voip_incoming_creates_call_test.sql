BEGIN;
-- Obrigatório, e tem que ser a PRIMEIRA linha depois do BEGIN. pgTAP não é
-- criado por migration nenhuma nem pelo config.toml, e como toda suíte roda
-- dentro de BEGIN/ROLLBACK ele nunca fica instalado entre arquivos.
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova a ENTRADA E2 (#1372, PRD #1370, ADR-0027) —
-- 20270805000000_voip_incoming_creates_call.sql: a ligação RECEBIDA vira linha
-- no CRM.
--
-- A COSTURA É A REUSADA. O evento novo entra pela MESMA
-- `fn_voip_apply_vps_event` dos outros cinco, e é por ela que este arquivo o
-- dispara. Chamar um INSERT à mão provaria outra coisa — provaria que a tabela
-- aceita a linha, que ninguém duvidava.
--
-- O QUE ESTÁ EM JOGO, em ordem de gravidade:
--
--  1. CRIAR NA ENTRADA NÃO PODE ABRIR CAMINHO PARA CRIAR NA SAÍDA. Esta função
--     está em produção desde 2026-08-02, carrega 87 asserções e é o único
--     caminho pelo qual o CRM aprende o que acontece nas chamadas. Até esta
--     fatia ela só ATUALIZAVA. Na saída a criação já tem dono
--     (`fn_voip_call_reserve`), que cobra cota, checa consentimento, valida a
--     instância e cunha o token — um segundo produtor de linha de saída seria
--     um jeito de discar sem passar por nada disso.
--
--  2. O `peer` PODE CHEGAR FORA DA FAIXA `^[0-9]{8,15}$`, e não é hipótese:
--     medido com sonda na revisão da E1 — conta LID sem `caller_pn` produz 17
--     dígitos, oferta de grupo com criador LID produz 18, `From` vazio produz
--     string vazia. O CHECK da coluna recusa com 23514, a exceção ABORTA A
--     TRANSAÇÃO INTEIRA, e a linha nunca é criada — em silêncio, que é o modo
--     de falhar que esta base já pagou caro.
--
--     E O LIMITE DA GUARDA É TESTADO JUNTO, porque foi o que a E1 pagou para
--     aprender: COMPRIMENTO NÃO DISTINGUE IDENTIFICADOR DE NÚMERO. Um LID de 8
--     a 15 dígitos passa pela faixa incólume. Quem distingue é o servidor do
--     JID, que não viaja no corpo do evento — o gate de verdade é o da VPS, e
--     esta guarda é a segunda linha, não a primeira.
--
--  3. OFERTA RETRANSMITIDA ANUNCIA DUAS VEZES (medido na E1). São DOIS
--     envelopes legítimos, com jti e seq DIFERENTES: o anti-replay do jti NÃO
--     cobre isso. Quem barra a segunda linha é `voip_calls_network_id_unique`.
--
--  4. O CASAMENTO DO TELEFONE TEM DUAS FORMAS. O JID chega `555185960716` (DDI
--     presente, nono dígito ausente); o CRM guarda `51985960716` (DDI ausente,
--     nono presente). E `leads.normalized_phone` não é garantidamente canônico:
--     medido em produção em 2026-08-03, 103 leads guardam 12 dígitos e 21
--     guardam 13 — com o DDI.
--
--  5. O ESTADO INICIAL NÃO É `authorized`. O default da coluna é vocabulário de
--     chamada que SAI ("o CRM autorizou, pode discar"). A ligação que entra
--     nasce TOCANDO, e sem dono — `operator_user_id` nulo, que já custou um
--     quase-incidente quando o gate de instância não esperava nulo.
--
--  6. RECUSA ESPERADA NÃO É INCIDENTE. O `peer` fora da faixa devolve
--     `peer_unusable` com `ok = true` (HTTP 202), e o registro é UM: o desta
--     função. `transition_refused` custaria três — a linha da RPC, a do
--     `CODE_ACTION` do endpoint e o `CRM RECUSOU` que a VPS escreve ao ver 4xx.
--
-- PROVA POR REVERSÃO — 13 mutantes, 13 mortos, 0 sobreviventes, 0 patches que
-- não aplicaram. O harness afirma que a âncora casou (0 ou 2+ ocorrências =
-- "NÃO APLICOU", contado separado de "sobreviveu") e nunca toca a árvore de
-- trabalho. Detalhe em `.superpowers/entrada/e2-report.md`.
--
--   M1  guarda de tipo removida (`IN ('incoming','call-status')`)
--   M2  `direction` lido do CORPO em vez do literal
--   M3  estado inicial volta ao default `authorized`
--   M4  guarda de faixa do peer removida (o CHECK derruba a transação)
--   M5  `ON CONFLICT DO NOTHING` removido (a retransmissão estoura)
--   M6  marca d'água não carimbada no INSERT
--   M7  casamento só pela forma canônica (perde os 124 leads com DDI)
--   M8  `fn_phone_match_forms` perde o ramo do nono dígito
--   M9  `REVOKE` só de PUBLIC (o pg_default_acl deixa `anon` executar)
--   M10 casamento sem o filtro de organização (travessia de tenant)
--   M11 recusa por telefone volta a `transition_refused` (2ª e 3ª linha de erro)
--   M12 filtro de soft-delete removido (lead apagado ressuscita na ligação)
--   M13 registro da recusa rebaixado de `error` para `skipped`
--
-- M1 mata TAMBÉM 20 das 87 asserções de `voip_webhook_ingest_test.sql`: afrouxar
-- a guarda de tipo não só abre a criação na saída, como sequestra o ramo que
-- move a chamada de fase.
--
-- M12 SOBREVIVEU na primeira rodada, e o motivo vale mais que o mutante: o JID
-- do caso do soft-delete tinha sido montado à mão, com a conta do nono dígito
-- errada, e não alcançava o lead apagado de jeito nenhum. A asserção "não
-- casou" passava pelo motivo errado. Daí o CONTROLE POSITIVO que acompanha
-- aquele caso — toda asserção NEGATIVA de casamento precisa de um.

SELECT plan(77);

-- ===========================================================================
-- (1) ESTRUTURA E GRANTS
-- ===========================================================================
-- to_regprocedure em vez de has_function_privilege direto: antes da migration o
-- objeto não existe, e has_*_privilege ESTOURA com objeto ausente — com
-- ON_ERROR_STOP=1 o arquivo inteiro abortaria antes de reportar um `not ok`.

SELECT ok(
  to_regprocedure('public.fn_phone_match_forms(text)') IS NOT NULL,
  'fn_phone_match_forms existe');

-- Neste projeto `REVOKE ... FROM PUBLIC` NÃO fecha função nova: o
-- ALTER DEFAULT PRIVILEGES do schema `public` concede EXECUTE a anon,
-- authenticated e service_role em tudo que nasce aqui. E `rls_invariants` NÃO
-- cobre grant de FUNÇÃO — na gravação (S2) o mutante que concedia acesso a anon
-- deixou aquela suíte verde. Por isso são asserções nominais, uma por papel.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_phone_match_forms(text)') IS NULL THEN false
       ELSE NOT has_function_privilege('anon',
              to_regprocedure('public.fn_phone_match_forms(text)')::oid, 'EXECUTE') END,
  'anon NÃO executa fn_phone_match_forms');

SELECT ok(
  CASE WHEN to_regprocedure('public.fn_phone_match_forms(text)') IS NULL THEN false
       ELSE NOT has_function_privilege('authenticated',
              to_regprocedure('public.fn_phone_match_forms(text)')::oid, 'EXECUTE') END,
  'authenticated NÃO executa fn_phone_match_forms');

-- Nem service_role: o único chamador legítimo é a RPC do webhook, que é
-- SECURITY DEFINER e roda como o DONO. Mesma escolha de fn_voip_project_call_log.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_phone_match_forms(text)') IS NULL THEN false
       ELSE NOT has_function_privilege('service_role',
              to_regprocedure('public.fn_phone_match_forms(text)')::oid, 'EXECUTE') END,
  'service_role NÃO executa fn_phone_match_forms — o caminho é a cadeia DEFINER');

-- Anti-regressão: a RPC foi recriada INTEIRA por CREATE OR REPLACE, e um
-- REVOKE esquecido no arquivo novo devolveria a função ao pg_default_acl.
SELECT ok(
  NOT has_function_privilege('anon',
    to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)')::oid,
    'EXECUTE'),
  'anon continua SEM EXECUTE na RPC depois da recriação');

SELECT ok(
  NOT has_function_privilege('authenticated',
    to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)')::oid,
    'EXECUTE'),
  'authenticated continua SEM EXECUTE na RPC depois da recriação');

SELECT ok(
  has_function_privilege('service_role',
    to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)')::oid,
    'EXECUTE'),
  'service_role continua COM EXECUTE na RPC — é quem a edge function usa');

-- ===========================================================================
-- (2) AS FORMAS DO TELEFONE — espelho de phoneVariants()
-- ===========================================================================
-- Os casos são os MESMOS de conversationCallsQuery.test.ts, de propósito: é
-- isso que transforma "espelho" em afirmação verificável.

SELECT set_eq(
  $$SELECT unnest(public.fn_phone_match_forms('48991892653'))$$,
  $$VALUES ('48991892653'),('5548991892653'),('4891892653'),('554891892653')$$,
  'canônico de 11 dígitos gera as QUATRO formas (mesmo caso do teste do chat)');

SELECT set_eq(
  $$SELECT unnest(public.fn_phone_match_forms('4833334444'))$$,
  $$VALUES ('4833334444'),('554833334444')$$,
  'número de 10 dígitos não ganha o ramo do nono dígito');

-- A FORMA QUE ESTA FATIA EXISTE PARA CASAR: o JID que o WhatsApp entrega.
SELECT ok(
  '555185960716' = ANY (public.fn_phone_match_forms('51985960716')),
  'a forma do JID (DDI presente, nono ausente) está entre as formas do canônico');

SELECT ok(
  (SELECT bool_and(length(f) BETWEEN 8 AND 15)
     FROM unnest(public.fn_phone_match_forms('48991892653')) AS f),
  'nenhuma forma cai fora de 8 a 15 dígitos — o que não cabe em peer_phone não casa com nada');

-- NULO não pode virar exceção nem casar com tudo.
SELECT is(
  public.fn_phone_match_forms(NULL),
  ARRAY[]::text[],
  'canônico nulo devolve conjunto VAZIO — não casa com lead nenhum');

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- session_replication_role = replica: `leads` tem ~20 gatilhos (webhooks,
-- workflows, sync de pipe) e whatsapp_instances tem
-- trg_enforce_whatsapp_instance_limit, que chama assert_org_access e levanta
-- P0001 rodando como postgres sem membro. Mesmo tratamento de
-- voip_webhook_ingest_test.sql:143 e voip_foundation_test.sql:167.
--
-- CONSEQUÊNCIA QUE IMPORTA: com os gatilhos desligados, `normalized_phone` NÃO
-- é derivado de `phone`. Ele é escrito à mão aqui — que é justamente o que
-- permite semear as formas NÃO canônicas medidas em produção.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('f0000001-0000-0000-0000-000000000001', 'membro-entrada@voip.test'),
  ('f0000001-0000-0000-0000-000000000002', 'forasteiro-entrada@voip.test');

INSERT INTO public.organizations (id, name, slug) VALUES
  ('f1111111-1111-1111-1111-111111111111', 'Org Entrada Teste',  'org-entrada-teste'),
  ('f1111111-1111-1111-1111-111111111112', 'Org Vizinha Entrada','org-vizinha-entrada');

INSERT INTO public.team_members (id, organization_id, user_id, name, email, role, is_active) VALUES
  ('f2222222-2222-2222-2222-222222222221', 'f1111111-1111-1111-1111-111111111111',
   'f0000001-0000-0000-0000-000000000001', 'Membro', 'membro-entrada@voip.test', 'member', true),
  ('f2222222-2222-2222-2222-222222222222', 'f1111111-1111-1111-1111-111111111112',
   'f0000001-0000-0000-0000-000000000002', 'Forasteiro', 'forasteiro-entrada@voip.test', 'member', true);

-- Duas instâncias: a voz LIGADA e a voz DESLIGADA. A segunda existe para provar
-- que o interruptor do CRM não impede o REGISTRO (ADR-0027, decisão 5).
INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap) VALUES
  ('f3333333-3333-3333-3333-333333333331', 'f1111111-1111-1111-1111-111111111111',
   'inst-entrada-voz-on',  true,  NULL),
  ('f3333333-3333-3333-3333-333333333332', 'f1111111-1111-1111-1111-111111111111',
   'inst-entrada-voz-off', false, NULL);

-- Os leads. As formas de `normalized_phone` são as MEDIDAS em produção
-- (2026-08-03): 32.968 linhas com 11 dígitos, 103 com 12 e 21 com 13.
INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone) VALUES
  -- L1 — canônico. Casado pelo JID `555185960716`. É o caso da fatia.
  ('f4444444-4444-4444-4444-444444444441', 'f1111111-1111-1111-1111-111111111111',
   'Lead Canonico', '+55 51 98596-0716', '51985960716'),
  -- L2 — gravado COM o DDI (12 dígitos). Contra ele a igualdade canônica erra.
  ('f4444444-4444-4444-4444-444444444442', 'f1111111-1111-1111-1111-111111111111',
   'Lead Com DDI', '+55 48 9100-5289', '554891005289'),
  -- L3/L4 — o MESMO telefone gravado nas duas formas. Serve para provar que a
  -- escolha é DETERMINÍSTICA: o canônico ganha.
  ('f4444444-4444-4444-4444-444444444443', 'f1111111-1111-1111-1111-111111111111',
   'Lead Duplo DDI', '+55 51 99999-8888', '5551999998888'),
  ('f4444444-4444-4444-4444-444444444444', 'f1111111-1111-1111-1111-111111111111',
   'Lead Duplo Canonico', '+55 51 99999-8888', '51999998888'),
  -- L5 — o ÚNICO cadastro deste telefone, e ele é da org VIZINHA. A travessia
  -- de tenant. Número exclusivo de propósito: se ele existisse também na org da
  -- sessão, o desempate por `created_at` poderia devolver o lead certo pelo
  -- motivo errado e a asserção ficaria verde sem provar nada.
  ('f4444444-4444-4444-4444-444444444445', 'f1111111-1111-1111-1111-111111111112',
   'Lead da Vizinha', '+55 51 97777-6666', '51977776666');

-- L6 — SOFT-DELETED, na org da sessão, e único dono deste telefone.
-- `deleted_at` é o que o `idx_leads_org_phone_unique` usa para permitir que o
-- número seja recadastrado, e um lead apagado não pode voltar à tona pendurado
-- numa ligação recebida. Em INSERT separado porque `deleted_at` não está na
-- lista de colunas acima.
INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, deleted_at)
VALUES ('f4444444-4444-4444-4444-444444444446', 'f1111111-1111-1111-1111-111111111111',
        'Lead Apagado', '+55 51 96666-5555', '51966665555', now() - interval '1 day');

-- Uma sessão por preocupação: a marca d'água é por entidade, e compartilhar
-- sessão faria um cenário embaralhar a ordem do outro.
INSERT INTO public.voip_sessions
  (organization_id, whatsapp_instance_id, tc_session_id, name, status) VALUES
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-cria',  'cria a linha',        'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-forma', 'a outra forma',       'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-canon', 'canonico ganha',      'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-semlead','numero sem cadastro','open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-tenant','cadastro da org vizinha','open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-apagado','cadastro soft-deleted','open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-saida', 'a saida nao cria',    'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-repete','reentrega',           'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-peer',  'peer fora da faixa',  'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-limite','o limite declarado', 'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333332','sess-in-mudo',  'voz desligada',       'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-ordem', 'a ordem dos eventos', 'open'),
  ('f1111111-1111-1111-1111-111111111111','f3333333-3333-3333-3333-333333333331','sess-in-hist',  'a projecao do S13',   'open');

-- De volta ao runtime real ANTES de qualquer evento: o INSERT que a RPC faz tem
-- que passar pelos gatilhos de verdade (a projeção do S13 é um deles).
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (3) A LINHA NASCE
-- ===========================================================================
-- `offeredAt` = 1754236800123 ms = 2025-08-03 16:00:00.123 UTC. Fora da janela
-- de 24 h que a função aceita, então ela cai para now() — o que é o
-- comportamento certo e NÃO o que se quer medir aqui. O carimbo do teste é
-- calculado a partir de now() para ficar dentro da faixa, e é comparado contra
-- o valor exato.

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000001', 'sess-in-cria', 1, 10, now(),
    jsonb_build_object(
      'type', 'incoming',
      'sessionId', 'sess-in-cria',
      'id', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01',
      'peer', '555185960716',
      'offeredAt', round(extract(epoch from now() - interval '20 seconds') * 1000)
    )
  ) ->> 'detail',
  'incoming_registered',
  'o aviso de entrada CRIA a linha (a RPC só sabia atualizar)');

SELECT is(
  (SELECT direction FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'inbound',
  'a linha nasce inbound — o literal, não o corpo');

-- O default da coluna é `authorized`, que é vocabulário de chamada que SAI.
SELECT is(
  (SELECT status FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'ringing',
  'a linha nasce TOCANDO, não `authorized`');

SELECT ok(
  (SELECT operator_user_id IS NULL FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'a linha nasce SEM DONO — quem atende é a E4');

SELECT is(
  (SELECT peer_phone FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  '555185960716',
  'o telefone é gravado COMO VEIO — nenhum dígito posto nem tirado no CRM');

-- O carimbo é o da VPS (`offeredAt`), não o instante de recepção.
SELECT ok(
  (SELECT ringing_at BETWEEN now() - interval '21 seconds' AND now() - interval '19 seconds'
     FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'ringing_at vem de offeredAt, não de now()');

SELECT ok(
  (SELECT authorized_at = ringing_at
     FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'authorized_at ancora no mesmo instante — ninguém autorizou nada, a oferta chegou');

SELECT ok(
  (SELECT last_seq_epoch = 1 AND last_seq = 10
     FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'a linha nasce com a marca d''água do próprio aviso');

-- O CASAMENTO: JID de 12 dígitos contra cadastro canônico de 11.
SELECT is(
  (SELECT lead_id FROM public.voip_calls WHERE tc_session_id = 'sess-in-cria'),
  'f4444444-4444-4444-4444-444444444441'::uuid,
  'o JID `555185960716` encontra o lead gravado como `51985960716`');

-- ===========================================================================
-- (4) O TELEFONE NA OUTRA FORMA, E QUANDO NÃO HÁ LEAD
-- ===========================================================================

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000002', 'sess-in-forma', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-forma',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA02','peer','554891005289',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'lead_matched',
  'true',
  'lead gravado COM o DDI (12 dígitos, 103 linhas em prod) também é encontrado');

SELECT is(
  (SELECT lead_id FROM public.voip_calls WHERE tc_session_id = 'sess-in-forma'),
  'f4444444-4444-4444-4444-444444444442'::uuid,
  'e é o lead certo, não outro qualquer');

-- Determinismo: duas formas do MESMO número cadastradas, o canônico ganha.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000003', 'sess-in-canon', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-canon',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA03','peer','555199998888',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'número com DOIS cadastros (canônico e com DDI) registra sem ambiguidade');

SELECT is(
  (SELECT lead_id FROM public.voip_calls WHERE tc_session_id = 'sess-in-canon'),
  'f4444444-4444-4444-4444-444444444444'::uuid,
  'entre duas formas do mesmo número, o cadastro CANÔNICO ganha');

-- 47% dos contatos dos últimos 90 dias não têm lead. A ligação vale assim mesmo.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000004', 'sess-in-semlead', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-semlead',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA04','peer','555133334444',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'lead_matched',
  'false',
  'número sem cadastro não finge ter encontrado lead');

SELECT ok(
  (SELECT lead_id IS NULL FROM public.voip_calls WHERE tc_session_id = 'sess-in-semlead'),
  'número sem cadastro grava a ligação com lead_id NULO — nada de inventar lead');

-- A TRAVESSIA DE TENANT. `51977776666` só existe como lead na org VIZINHA. A
-- sessão é da org de teste, e a organização sai de `voip_sessions`, nunca do
-- corpo — então o casamento não pode alcançar aquele cadastro.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000018', 'sess-in-tenant', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-tenant',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA18','peer','555177776666',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'telefone cadastrado só na org vizinha registra a ligação na org da sessão');

SELECT ok(
  (SELECT lead_id IS NULL FROM public.voip_calls WHERE tc_session_id = 'sess-in-tenant'),
  'e NÃO casa com o lead da org vizinha — o casamento é escopado pela organização da sessão');

-- LEAD APAGADO NÃO VOLTA À TONA PENDURADO NUMA LIGAÇÃO.
-- `deleted_at` é o mesmo predicado que o `idx_leads_org_phone_unique` usa para
-- liberar o número a um cadastro novo; casar com o apagado ressuscitaria na
-- linha do tempo um lead que alguém removeu de propósito.
--
-- CONTROLE POSITIVO, E ELE É OBRIGATÓRIO AQUI. Uma asserção "não casou" passa
-- verde por DOIS motivos: porque o soft-delete foi respeitado, ou porque o
-- telefone do teste não alcançava aquele lead de qualquer jeito. A primeira
-- versão deste caso caiu na segunda armadilha — eu montei o JID à mão e errei a
-- conta do nono dígito, o mutante do `deleted_at` SOBREVIVEU, e só o harness de
-- reversão mostrou. Esta linha afirma que a ÚNICA coisa entre o peer e o lead é
-- o `deleted_at`.
SELECT ok(
  (SELECT l.normalized_phone = ANY (
            public.fn_phone_match_forms(public.normalize_brazilian_phone('555166665555')))
     FROM public.leads l WHERE l.id = 'f4444444-4444-4444-4444-444444444446'),
  'controle: o peer do caso abaixo ALCANÇA o lead apagado pelo telefone');

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000023', 'sess-in-apagado', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-apagado',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA23','peer','555166665555',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'lead_matched',
  'false',
  'telefone que só um lead APAGADO tem não conta como cadastro encontrado');

SELECT ok(
  (SELECT lead_id IS NULL FROM public.voip_calls WHERE tc_session_id = 'sess-in-apagado'),
  'e a ligação é registrada com lead_id NULO — o soft-delete é respeitado');

-- ===========================================================================
-- (5) `direction` E `status` SÃO LITERAIS, NUNCA O CORPO
-- ===========================================================================
-- Se o corpo pudesse decidir, a VPS (ou quem falsificasse um envelope) mandaria
-- o CRM registrar chamada de SAÍDA sem passar por fn_voip_call_reserve.

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000005', 'sess-in-mudo', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-mudo',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA05','peer','555185960716',
      'direction','outbound', 'status','connected',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'aviso com direction/status no corpo é aceito — os campos é que são ignorados');

SELECT is(
  (SELECT direction FROM public.voip_calls WHERE tc_session_id = 'sess-in-mudo'),
  'inbound',
  'o corpo diz `outbound`; a linha diz `inbound`');

SELECT is(
  (SELECT status FROM public.voip_calls WHERE tc_session_id = 'sess-in-mudo'),
  'ringing',
  'o corpo diz `connected`; a linha diz `ringing`');

-- E a mesma linha prova a decisão 5 do ADR-0027: esta sessão está na instância
-- com voice_calls_enabled = FALSE.
SELECT ok(
  (SELECT NOT i.voice_calls_enabled
     FROM public.voip_sessions s
     JOIN public.whatsapp_instances i ON i.id = s.whatsapp_instance_id
    WHERE s.tc_session_id = 'sess-in-mudo'),
  'a instância desta sessão está com a VOZ DESLIGADA (o controle do caso acima)');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-mudo'),
  1,
  'voz desligada REGISTRA assim mesmo — o interruptor é de tocar e atender, não de saber');

-- ===========================================================================
-- (6) A SAÍDA CONTINUA SEM PODER CRIAR
-- ===========================================================================
-- É a asserção mais importante do arquivo. `call-status` e `call-ended` servem
-- entrada E saída; se a guarda de tipo do ramo `incoming` afrouxar, eles passam
-- a criar linha — e do lado de fora de fn_voip_call_reserve.

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000006', 'sess-in-saida', 1, 10, now(),
    jsonb_build_object('type','call-status','sessionId','sess-in-saida',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA06','status','ringing',
      'direction','outbound','peer','555185960716',
      'startedAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'call_not_found',
  'call-status sobre chamada inexistente continua devolvendo call_not_found');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-saida'),
  0,
  'call-status NÃO criou linha — nem com peer e direction no corpo');

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000007', 'sess-in-saida', 1, 11, now(),
    jsonb_build_object('type','call-ended','sessionId','sess-in-saida',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA07','reason','user_ended',
      'direction','outbound','peer','555185960716',
      'endedAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'call_not_found',
  'call-ended sobre chamada inexistente continua devolvendo call_not_found');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-saida'),
  0,
  'call-ended NÃO criou linha');

-- Um tipo que ninguém conhece também não cria.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000008', 'sess-in-saida', 1, 12, now(),
    jsonb_build_object('type','outgoing','sessionId','sess-in-saida',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA08','peer','555185960716')
  ) ->> 'detail',
  'unknown_type',
  'tipo desconhecido continua caindo em unknown_type');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-saida'),
  0,
  'tipo desconhecido NÃO criou linha');

-- Nenhuma linha de SAÍDA existe em lugar nenhum deste arquivo: a única porta de
-- criação exercida aqui é o `incoming`, e ela escreve `inbound` sempre.
SELECT ok(
  (SELECT bool_and(direction = 'inbound') FROM public.voip_calls
    WHERE organization_id = 'f1111111-1111-1111-1111-111111111111'),
  'toda linha criada nesta suíte é inbound — a entrada não abriu porta para a saída');

-- ===========================================================================
-- (7) REENTREGA E OFERTA RETRANSMITIDA
-- ===========================================================================

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000009', 'sess-in-repete', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-repete',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA09','peer','555185960716',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'o primeiro aviso registra');

-- (a) MESMO envelope: o jti barra.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000009', 'sess-in-repete', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-repete',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA09','peer','555185960716',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'code',
  'replay',
  'a MESMA entrega devolve replay — o anti-replay do jti não foi afrouxado');

-- (b) Oferta RETRANSMITIDA: envelope NOVO, jti novo, seq novo. A E1 mediu que
--     isso acontece. `lives_ok` porque sem ON CONFLICT isto é unique_violation,
--     que aborta a transação — o defeito que se quer impossível.
SELECT lives_ok(
  $$SELECT public.fn_voip_apply_vps_event(
      'a0000000-0000-0000-0000-000000000010', 'sess-in-repete', 1, 11, now(),
      jsonb_build_object('type','incoming','sessionId','sess-in-repete',
        'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA09','peer','555185960716',
        'offeredAt', round(extract(epoch from now()) * 1000)))$$,
  'oferta RETRANSMITIDA não derruba a transação');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-repete'),
  1,
  'oferta retransmitida NÃO gera segunda linha — quem barra é a chave de rede, não o jti');

SELECT ok(
  (SELECT last_seq = 10 FROM public.voip_calls WHERE tc_session_id = 'sess-in-repete'),
  'o anúncio repetido NÃO avança a marca d''água — evento no ar não pode virar velho');

-- ===========================================================================
-- (8) O `peer` FORA DA FAIXA — RECUSA LIMPA, NUNCA EXCEÇÃO
-- ===========================================================================
-- Os três valores são os MEDIDOS com sonda na revisão da E1.

-- 17 dígitos: conta LID sem `caller_pn`.
SELECT lives_ok(
  $$SELECT public.fn_voip_apply_vps_event(
      'a0000000-0000-0000-0000-000000000011', 'sess-in-peer', 1, 10, now(),
      jsonb_build_object('type','incoming','sessionId','sess-in-peer',
        'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA11','peer','12345678901234567',
        'offeredAt', round(extract(epoch from now()) * 1000)))$$,
  'peer de 17 dígitos (LID sem caller_pn) NÃO derruba a transação');

-- O DESFECHO INTEIRO, e não só o `detail`: é o contrato que o endpoint roteia.
--
-- `code = 'peer_unusable'` com `ok = true` → HTTP 202. NÃO `transition_refused`
-- (409), que está no `CODE_ACTION` do endpoint e faria ele escrever uma SEGUNDA
-- linha de `runtime_logs` em nível error, e a VPS uma TERCEIRA
-- (`webhook: CRM RECUSOU`, ao ver 4xx). Três incidentes por oferta que o desenho
-- ESPERA recusar, para uma população que a E1 mediu como real.
-- **Recusa esperada não é incidente.**
SELECT is(
  (SELECT r::text FROM (
     SELECT public.fn_voip_apply_vps_event(
       'a0000000-0000-0000-0000-000000000012', 'sess-in-peer', 1, 11, now(),
       jsonb_build_object('type','incoming','sessionId','sess-in-peer',
         'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA12','peer','12345678901234567',
         'offeredAt', round(extract(epoch from now()) * 1000))) AS r) s),
  jsonb_build_object('ok', true, 'code', 'peer_unusable',
                     'detail', 'peer_phone_unusable')::text,
  'peer fora da faixa devolve código PRÓPRIO com ok=true — recusa esperada não é incidente');

-- 18 dígitos: oferta de grupo com criador LID.
SELECT lives_ok(
  $$SELECT public.fn_voip_apply_vps_event(
      'a0000000-0000-0000-0000-000000000013', 'sess-in-peer', 1, 12, now(),
      jsonb_build_object('type','incoming','sessionId','sess-in-peer',
        'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA13','peer','123456789012345678',
        'offeredAt', round(extract(epoch from now()) * 1000)))$$,
  'peer de 18 dígitos (oferta de grupo) NÃO derruba a transação');

-- `From` vazio.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000014', 'sess-in-peer', 1, 13, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-peer',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14','peer','',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'code',
  'peer_unusable',
  'peer vazio (From vazio na VPS) recusa limpo');

-- JID cru. NÃO pode ser "consertado" filtrando dígitos: o sufixo de aparelho
-- `:12` produziria 14 dígitos que PASSAM pelo CHECK e não casam com ninguém.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000015', 'sess-in-peer', 1, 14, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-peer',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA15','peer','555185960716:12@s.whatsapp.net',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'code',
  'peer_unusable',
  'JID cru é RECUSADO, não filtrado — desmontar JID é da VPS');

-- Campo ausente.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000016', 'sess-in-peer', 1, 15, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-peer',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA16',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'code',
  'peer_unusable',
  'aviso SEM o campo peer recusa limpo');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-peer'),
  0,
  'nenhum peer fora da faixa virou linha');

-- O LIMITE DECLARADO, e ele é asserção justamente para não virar descoberta.
--
-- A guarda acima diz "cabe na coluna", NÃO "é telefone". Comprimento não
-- distingue identificador de número: um LID de 15 dígitos passa por ela
-- incólume — e TEM que passar, porque 15 dígitos é também o teto de um número
-- internacional legítimo (E.164). Quem distingue é o SERVIDOR do JID
-- (`s.whatsapp.net` × `lid`), campo que não viaja no corpo do evento; o gate de
-- verdade é o da VPS. A ligação registrada assim não casa com lead nenhum, e é
-- esse o custo — visível, não corrompido.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000019', 'sess-in-limite', 1, 10, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-limite',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA19','peer','123456789012345',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'peer de 15 dígitos é ACEITO — a faixa é domínio da coluna, não prova de telefone');

SELECT ok(
  (SELECT lead_id IS NULL FROM public.voip_calls WHERE tc_session_id = 'sess-in-limite'),
  'e o custo do limite é este: não casa com lead nenhum (um LID curto entraria assim)');

-- UMA RECUSA, UM REGISTRO — e a contagem é EXATA de propósito.
--
-- Seis avisos foram recusados por telefone acima (17 dígitos ×2, 18 dígitos,
-- vazio, JID cru, campo ausente); o sétimo, sem `id`, sai antes e não registra.
-- `>=` deixaria passar o defeito que esta fatia corrigiu: recusa que escala para
-- duas linhas. Se um caso novo entrar na seção, este número sobe junto — de
-- propósito, porque é isso que força a conta a ser olhada.
SELECT is(
  (SELECT count(*)::int FROM public.runtime_logs
    WHERE module = 'voip' AND action = 'webhook_entrada_sem_telefone'
      AND status = 'error'
      AND organization_id = 'f1111111-1111-1111-1111-111111111111'),
  6,
  'seis recusas por telefone, SEIS linhas em runtime_logs — nem uma a mais');

SELECT ok(
  (SELECT bool_and((payload_snapshot->>'faixa_aceita') = '8-15'
                   AND payload_snapshot ? 'digitos' AND payload_snapshot ? 'peer')
     FROM public.runtime_logs
    WHERE module = 'voip' AND action = 'webhook_entrada_sem_telefone'),
  'o registro carrega o peer, quantos dígitos vieram e qual era a faixa');

-- Sem call-id não há do que falar: nem com a chave de rede, nem com o ledger.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000017', 'sess-in-peer', 1, 16, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-peer',
      'peer','555185960716',
      'offeredAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'missing_call_id',
  'aviso sem id de chamada recusa em missing_call_id');

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls WHERE tc_session_id = 'sess-in-peer'),
  0,
  'aviso sem id de chamada NÃO criou linha');

-- ===========================================================================
-- (9) A ORDEM DEPOIS DO AVISO
-- ===========================================================================
-- O contrato da E1: incoming (seq N) → call-status ringing (N+1) →
-- call-status connected (N+2) → call-ended. O aviso CRIA; os outros ATUALIZAM.

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000020', 'sess-in-ordem', 1, 20, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-ordem',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA20','peer','555185960716',
      'offeredAt', round(extract(epoch from now() - interval '30 seconds') * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'a sequência começa pelo aviso');

-- A MARCA D'ÁGUA CARIMBADA NO INSERT É LOAD-BEARING, e é este bloco que prova.
-- Um `connected` com seq MENOR que o do aviso é reordenação DE VERDADE. Com a
-- marca d'água nascida em 20, ele cai na FAIXA TARDIA: preenche o carimbo NULO
-- e NUNCA escreve status. Sem ela a linha nasceria com `last_seq = 0` (o
-- DEFAULT da coluna), qualquer seq positivo pareceria novo, e um evento velho
-- promoveria a chamada a `connected`.
SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000021', 'sess-in-ordem', 1, 5, now(),
    jsonb_build_object('type','call-status','sessionId','sess-in-ordem',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA20','status','connected')
  ) ->> 'detail',
  'late_connected_at',
  'evento com seq MENOR que o do aviso cai na FAIXA TARDIA');

SELECT ok(
  (SELECT connected_at IS NOT NULL FROM public.voip_calls WHERE tc_session_id = 'sess-in-ordem'),
  'a faixa tardia preencheu o carimbo que só aquele evento carrega');

SELECT is(
  (SELECT status FROM public.voip_calls WHERE tc_session_id = 'sess-in-ordem'),
  'ringing',
  'e NÃO promoveu a chamada — a faixa tardia nunca escreve status');

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000022', 'sess-in-ordem', 1, 21, now(),
    jsonb_build_object('type','call-status','sessionId','sess-in-ordem',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA20','status','connected',
      -- O `peer` do `call-status` vem de origem DIFERENTE da do `incoming` e
      -- diverge em conta LID. Ele viaja aqui de propósito, para provar que a
      -- RPC não o escreve.
      'peer','999999999999')
  ) ->> 'detail',
  'connected',
  'o call-status EM ORDEM ENCONTRA a linha — não vai mais para webhook_chamada_desconhecida');

-- AVISO EXPLÍCITO DA E1: `peer_phone` não é escrito em nenhum ramo desta função
-- além do INSERT da entrada, e não pode passar a ser. As duas origens do `peer`
-- divergem em conta LID; um UPDATE no ramo de `call-status` transformaria a
-- divergência em dado errado, calado, na coluna que casa a ligação com o lead.
SELECT is(
  (SELECT peer_phone FROM public.voip_calls WHERE tc_session_id = 'sess-in-ordem'),
  '555185960716',
  'nenhum evento posterior reescreve peer_phone — só o INSERT da entrada o escreve');

-- ===========================================================================
-- (10) A PROJEÇÃO DO S13 LEVA AO HISTÓRICO
-- ===========================================================================
-- Cria pelo aviso, encerra pelo call-ended, e a ligação aparece onde o vendedor
-- olha — pelos gatilhos de verdade, com session_replication_role = origin.

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000030', 'sess-in-hist', 1, 30, now(),
    jsonb_build_object('type','incoming','sessionId','sess-in-hist',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA30','peer','555185960716',
      'offeredAt', round(extract(epoch from now() - interval '40 seconds') * 1000))
  ) ->> 'detail',
  'incoming_registered',
  'a ligação do histórico nasce pelo aviso');

SELECT is(
  public.fn_voip_apply_vps_event(
    'a0000000-0000-0000-0000-000000000031', 'sess-in-hist', 1, 31, now(),
    jsonb_build_object('type','call-ended','sessionId','sess-in-hist',
      'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA30','reason','timeout',
      'endedAt', round(extract(epoch from now()) * 1000))
  ) ->> 'detail',
  'ended',
  'e é encerrada pelo call-ended, como qualquer outra');

SELECT is(
  (SELECT direction FROM public.call_logs
    WHERE voip_call_id = (SELECT id::text FROM public.voip_calls WHERE tc_session_id = 'sess-in-hist')),
  'inbound',
  'a projeção do S13 registrou a ligação RECEBIDA em call_logs');

SELECT is(
  (SELECT outcome FROM public.call_logs
    WHERE voip_call_id = (SELECT id::text FROM public.voip_calls WHERE tc_session_id = 'sess-in-hist')),
  'no_answer',
  'ligação recebida e não atendida vira `no_answer`, não falha técnica');

SELECT ok(
  (SELECT user_id IS NULL AND duration_seconds IS NULL FROM public.call_logs
    WHERE voip_call_id = (SELECT id::text FROM public.voip_calls WHERE tc_session_id = 'sess-in-hist')),
  'sem operador e sem duração — ninguém atendeu, e 0 seria um valor MEDIDO');

SELECT ok(
  EXISTS (SELECT 1 FROM public.lead_history
           WHERE lead_id = 'f4444444-4444-4444-4444-444444444441'
             AND action = 'call_logged'
             AND description LIKE 'Ligação recebida%'),
  'a ligação recebida chega à linha do tempo do lead');

-- ===========================================================================
-- (11) QUEM VÊ A LINHA — exercido como `authenticated`
-- ===========================================================================
-- `postgres` bypassa RLS e produziria falso verde. A policy de voip_calls é
-- `organization_id IN (get_my_organization_ids()) AND voip_can_see_call(lead_id)`,
-- e `voip_can_see_call(NULL)` é TRUE de propósito: uma ligação de número
-- desconhecido é fato da ORGANIZAÇÃO, não de um lead.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f0000001-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT ok(
  (SELECT count(*) > 0 FROM public.voip_calls WHERE tc_session_id = 'sess-in-semlead'),
  'membro da org VÊ a ligação recebida de número sem cadastro');

SET LOCAL request.jwt.claims TO '{"sub":"f0000001-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.voip_calls
    WHERE organization_id = 'f1111111-1111-1111-1111-111111111111'),
  0,
  'forasteiro de outra org não vê ligação recebida nenhuma');

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE organization_id = 'f1111111-1111-1111-1111-111111111111'
      AND voip_call_id IS NOT NULL),
  0,
  'nem o registro projetado dela');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

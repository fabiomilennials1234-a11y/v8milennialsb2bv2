BEGIN;
-- Obrigatório, e tem que ser a PRIMEIRA linha depois do BEGIN. pgTAP não é
-- criado por migration nenhuma nem pelo config.toml, e como toda suíte roda
-- dentro de BEGIN/ROLLBACK ele nunca fica instalado entre arquivos. Sem esta
-- linha, `SELECT plan(...)` estoura com "function plan(integer) does not exist".
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova fn_voip_apply_vps_event (20270730000010_voip_webhook_ingest.sql) — a
-- aplicação do evento assinado que a VPS entrega ao CRM.
--
-- O QUE ESTÁ EM JOGO, em ordem de gravidade:
--
--  1. ANTI-REPLAY. O mesmo envelope entregue duas vezes não pode aplicar duas
--     vezes. Sem isso, uma retentativa da VPS (que existe: o emissor é
--     best-effort com retry) reaplica transição de sessão e reabre chamada.
--
--  2. ORDEM. `epoch` sobe a cada restart da VPS; `seq` é monotônico dentro do
--     epoch. EPOCH MAIOR COM SEQ MENOR TEM QUE SER ACEITO — é o caso do
--     restart, e é o ponto inteiro de existir epoch. Comparar só `seq` faria o
--     CRM descartar tudo depois de um restart.
--
--  3. A CORRIDA COM O VARREDOR, que é REAL: `voip-sweep-stuck-calls` fecha
--     `ringing` parado há mais de 2 minutos com `end_reason =
--     'no_terminal_event'` — 4 das 7 chamadas de produção hoje foram fechadas
--     por ele. Um `connected` entregue depois encontra a linha já `ended`.
--     Ressuscitar é certo quando quem fechou foi o VARREDOR; é errado quando
--     quem fechou foi o OPERADOR. E só é possível quando o operador não tem
--     outra chamada viva, porque `idx_voip_calls_one_live_per_operator` é
--     UNIQUE parcial e a escrita estouraria.
SELECT plan(48);

-- ===========================================================================
-- ESTRUTURA
-- ===========================================================================
-- to_regclass/to_regprocedure em vez de has_function_privilege direto: antes da
-- migration o objeto não existe, e has_*_privilege ESTOURA com objeto ausente —
-- com ON_ERROR_STOP=1 (que o run.sh usa) o arquivo inteiro abortaria antes de
-- reportar um único `not ok`. CASE garante a ordem de avaliação; `AND` não.

SELECT has_table('public'::name, 'voip_webhook_events'::name,
  'voip_webhook_events existe');

SELECT has_column('public'::name, 'voip_sessions'::name, 'last_seq_epoch'::name,
  'voip_sessions ganhou a marca d''água de epoch');

SELECT has_column('public'::name, 'voip_sessions'::name, 'last_seq'::name,
  'voip_sessions ganhou a marca d''água de seq');

SELECT ok(
  to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)') IS NOT NULL,
  'fn_voip_apply_vps_event existe com a assinatura do contrato');

SELECT ok(
  COALESCE((SELECT c.relrowsecurity FROM pg_class c
             WHERE c.oid = to_regclass('public.voip_webhook_events')), false),
  'voip_webhook_events tem RLS habilitada (invariante 3 do #638)');

-- A tabela nasce dentro do pg_default_acl do schema public, que concede anon.
-- REVOKE de PUBLIC não alcança grant direto — por isso a migration revoga os
-- dois, e por isso isto é asserção e não confiança.
SELECT ok(
  CASE WHEN to_regclass('public.voip_webhook_events') IS NULL THEN false
       ELSE NOT has_table_privilege('anon', 'public.voip_webhook_events', 'SELECT') END,
  'anon NÃO lê voip_webhook_events');

-- TRUNCATE **não passa por RLS**. As policies desta tabela só cobrem SELECT, o
-- que mata INSERT/UPDATE/DELETE de authenticated — mas o `D` herdado do
-- pg_default_acl permitiria apagar a janela de anti-replay inteira, de todos os
-- tenants, de fora. Por isso a migration revoga de authenticated ANTES de
-- conceder SELECT, e por isso isto é asserção.
SELECT ok(
  CASE WHEN to_regclass('public.voip_webhook_events') IS NULL THEN false
       ELSE NOT has_table_privilege('authenticated', 'public.voip_webhook_events', 'TRUNCATE') END,
  'authenticated NÃO pode TRUNCATE a janela de anti-replay');

SELECT ok(
  CASE WHEN to_regclass('public.voip_webhook_events') IS NULL THEN false
       ELSE has_table_privilege('authenticated', 'public.voip_webhook_events', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.voip_webhook_events', 'INSERT')
        AND NOT has_table_privilege('authenticated', 'public.voip_webhook_events', 'UPDATE')
        AND NOT has_table_privilege('authenticated', 'public.voip_webhook_events', 'DELETE') END,
  'authenticated tem SELECT e só SELECT');

SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)') IS NULL THEN false
       ELSE NOT has_function_privilege('anon',
              to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)')::oid,
              'EXECUTE') END,
  'anon NÃO tem EXECUTE na RPC');

SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)') IS NULL THEN false
       ELSE NOT has_function_privilege('authenticated',
              to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)')::oid,
              'EXECUTE') END,
  'authenticated NÃO tem EXECUTE na RPC — quem chama é a edge function');

SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)') IS NULL THEN false
       ELSE has_function_privilege('service_role',
              to_regprocedure('public.fn_voip_apply_vps_event(uuid,text,bigint,bigint,timestamptz,jsonb)')::oid,
              'EXECUTE') END,
  'service_role tem EXECUTE na RPC');

-- Reserva de jti sem faxina é tabela que cresce para sempre.
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job
           WHERE jobname = 'voip-webhook-events-cleanup'
             AND active = true
             AND schedule = '*/5 * * * *'),
  'voip-webhook-events-cleanup está agendado, ativo, a cada 5 minutos');

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- OBRIGATÓRIO. whatsapp_instances tem trg_enforce_whatsapp_instance_limit
-- BEFORE INSERT, que chama org_resolve_quota -> assert_org_access(p_org_id).
-- Rodando como postgres via psql (auth.role()/auth.uid() nulos, org sem membro),
-- isso levanta P0001 access_denied, e com ON_ERROR_STOP=1 o arquivo aborta antes
-- de qualquer asserção. Mesmo tratamento de voip_foundation_test.sql:167,
-- voip_call_id_provenance_test.sql:50 e voip_sweep_stuck_calls_test.sql:40.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'op-ressurreicao@voip.test'),
  ('b0000001-0000-0000-0000-000000000002', 'op-ocupado@voip.test');

-- organizations exige name E slug (os dois NOT NULL sem default).
INSERT INTO public.organizations (id, name, slug)
VALUES ('b1111111-1111-1111-1111-111111111111', 'Org Webhook Teste', 'org-webhook-teste');

INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111',
        'inst-webhook-teste', true, NULL);

-- Uma sessão por preocupação: a marca d'água é POR SESSÃO, então compartilhar
-- sessão entre cenários faria um teste embaralhar a ordem do outro e o motivo da
-- falha viraria adivinhação.
INSERT INTO public.voip_sessions
  (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-auth',  'ordem e transição de sessão', 'pending'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-quar',  'sessão inerte',               'quarantined'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-call',  'ciclo de vida da chamada',    'open'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-res',   'ressurreição legítima',       'open'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-user',  'fechada pelo operador',       'open'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-busy',  'operador já ocupado',         'open');

-- De volta ao runtime real ANTES das asserções: o que se mede tem que ser o
-- comportamento com triggers ligados. voip_calls não tem trigger não-interno
-- (conferido), então os carimbos abaixo são exatos.
SET LOCAL session_replication_role = origin;

INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, operator_user_id,
   peer_phone, direction, status, end_reason, authorized_at, ringing_at, connected_at, ended_at)
VALUES
  -- Chamada tocando: recebe connected e depois o fim.
  ('c0000001-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-call', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  -- Chamada tocando: recebe um call-ended com motivo FORA do conjunto fechado.
  ('c0000001-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-call', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA02', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  -- Fechada PELO VARREDOR. Operador livre: ressuscitável.
  ('c0000001-0000-0000-0000-000000000003', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-res', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA03', 'b0000001-0000-0000-0000-000000000001',
   '5548991005289', 'outbound', 'ended', 'no_terminal_event',
   now() - interval '5 minutes', now() - interval '5 minutes', NULL, now() - interval '3 minutes'),

  -- Fechada PELO OPERADOR. Nunca ressuscita.
  ('c0000001-0000-0000-0000-000000000004', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-user', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA04', NULL,
   '5548991005289', 'outbound', 'ended', 'user_ended',
   now() - interval '5 minutes', now() - interval '5 minutes', NULL, now() - interval '4 minutes'),

  -- Fechada pelo varredor, MAS o operador já está em outra chamada viva.
  ('c0000001-0000-0000-0000-000000000005', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-busy', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA05', 'b0000001-0000-0000-0000-000000000002',
   '5548991005289', 'outbound', 'ended', 'no_terminal_event',
   now() - interval '5 minutes', now() - interval '5 minutes', NULL, now() - interval '3 minutes'),

  -- A outra chamada viva do mesmo operador. Só ela pode ocupar o índice único
  -- parcial idx_voip_calls_one_live_per_operator.
  ('c0000001-0000-0000-0000-000000000006', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-busy', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA06', 'b0000001-0000-0000-0000-000000000002',
   '5548991005289', 'outbound', 'connected', NULL,
   now() - interval '1 minute', now() - interval '1 minute', now() - interval '50 seconds', NULL);

-- ===========================================================================
-- EXECUÇÃO
-- ===========================================================================
-- Cada evento roda UMA vez e o resultado é materializado. Os snapshots de estado
-- também: a asserção do replay tem que ver a marca d'água NO INSTANTE seguinte
-- ao replay, antes de os eventos posteriores a moverem.
CREATE TEMP TABLE ev (nome text PRIMARY KEY, r jsonb);

-- --- sessão inexistente e sessão em quarentena -----------------------------
INSERT INTO ev VALUES ('sem_sessao', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000001', 'sess-que-nao-existe', 1, 1, now(),
  '{"type":"auth-state","sessionId":"sess-que-nao-existe","paired":true,"state":"open"}'::jsonb));

INSERT INTO ev VALUES ('quarentena', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000002', 'sess-wh-quar', 1, 1, now(),
  '{"type":"auth-state","sessionId":"sess-wh-quar","paired":true,"state":"open"}'::jsonb));

-- --- ordem e transição de sessão (sess-wh-auth, nasce `pending`) -----------
-- (epoch 1, seq 7): pending + open -> open.
INSERT INTO ev VALUES ('auth_open', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000010', 'sess-wh-auth', 1, 7, now(),
  '{"type":"auth-state","sessionId":"sess-wh-auth","paired":true,"state":"open"}'::jsonb));

INSERT INTO ev VALUES ('auth_open_estado', (
  SELECT jsonb_build_object('status', s.status, 'epoch', s.last_seq_epoch, 'seq', s.last_seq)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-auth'));

-- MESMO jti, seq MAIOR. Se o replay não fosse detectado, a marca d'água iria
-- para 9 — é isso que a asserção seguinte mede. Repetir o mesmo seq provaria
-- menos: `out_of_order` sozinho já barraria.
INSERT INTO ev VALUES ('replay', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000010', 'sess-wh-auth', 1, 9, now(),
  '{"type":"auth-state","sessionId":"sess-wh-auth","paired":false,"state":"logged_out"}'::jsonb));

INSERT INTO ev VALUES ('replay_estado', (
  SELECT jsonb_build_object('status', s.status, 'epoch', s.last_seq_epoch, 'seq', s.last_seq)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-auth'));

-- jti novo, MESMO epoch, seq MENOR -> fora de ordem.
INSERT INTO ev VALUES ('fora_de_ordem', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000011', 'sess-wh-auth', 1, 3, now(),
  '{"type":"auth-state","sessionId":"sess-wh-auth","paired":false,"state":"logged_out"}'::jsonb));

-- RESTART DA VPS: epoch MAIOR com seq MENOR. Tem que ser ACEITO.
INSERT INTO ev VALUES ('epoch_maior', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000012', 'sess-wh-auth', 2, 1, now(),
  '{"type":"auth-state","sessionId":"sess-wh-auth","paired":true,"state":"open"}'::jsonb));

-- `qr` numa sessão `open`: recusa. Sessão viva não volta para a tela de
-- pareamento por evento atrasado.
INSERT INTO ev VALUES ('qr_em_open', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000013', 'sess-wh-auth', 2, 2, now(),
  '{"type":"auth-state","sessionId":"sess-wh-auth","paired":false,"state":"qr"}'::jsonb));

INSERT INTO ev VALUES ('qr_em_open_estado', (
  SELECT jsonb_build_object('status', s.status)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-auth'));

-- --- ciclo de vida da chamada (sess-wh-call) -------------------------------
INSERT INTO ev VALUES ('connected', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000020', 'sess-wh-call', 1, 1, now(),
  '{"type":"call-status","sessionId":"sess-wh-call","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('connected_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01'));

INSERT INTO ev VALUES ('encerrada', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000021', 'sess-wh-call', 1, 2, now(),
  '{"type":"call-ended","sessionId":"sess-wh-call","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01",
    "reason":"declined"}'::jsonb));

INSERT INTO ev VALUES ('encerrada_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01'));

-- Motivo FORA do conjunto fechado do Go. `no_terminal_event` é o motivo PRÓPRIO
-- do varredor: se a VPS conseguisse escrevê-lo, ela corromperia a métrica que
-- mede o atraso do próprio webhook E ganharia uma alavanca de ressurreição.
INSERT INTO ev VALUES ('motivo_forjado', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000022', 'sess-wh-call', 1, 3, now(),
  '{"type":"call-ended","sessionId":"sess-wh-call","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA02",
    "reason":"no_terminal_event"}'::jsonb));

INSERT INTO ev VALUES ('motivo_forjado_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA02'));

-- --- a corrida com o varredor ---------------------------------------------
INSERT INTO ev VALUES ('ressuscita', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000030', 'sess-wh-res', 1, 1, now(),
  '{"type":"call-status","sessionId":"sess-wh-res","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA03",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('ressuscita_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA03'));

INSERT INTO ev VALUES ('nao_ressuscita', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000031', 'sess-wh-user', 1, 1, now(),
  '{"type":"call-status","sessionId":"sess-wh-user","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA04",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('nao_ressuscita_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA04'));

INSERT INTO ev VALUES ('operador_ocupado', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000032', 'sess-wh-busy', 1, 1, now(),
  '{"type":"call-status","sessionId":"sess-wh-busy","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA05",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('operador_ocupado_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA05'));

-- ===========================================================================
-- ASSERÇÕES
-- ===========================================================================

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'sem_sessao'), 'session_not_found',
  'sessão que não existe aqui devolve session_not_found (a VPS não deve retentar)');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'quarentena'), 'session_inert',
  'sessão em quarentena é inerte');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'auth_open'), 'applied',
  'auth-state open é aplicado numa sessão pending');

SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'auth_open_estado'), 'open',
  'pending + open vira open');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'replay'), 'replay',
  'o mesmo event_jti duas vezes devolve replay');

-- A asserção que importa do replay não é o código — é que NADA mudou. O payload
-- do replay pede logged_out e o seq pede 9; se qualquer um dos dois tivesse
-- efeito, este ok() ficaria vermelho.
SELECT ok(
  (SELECT r->>'status' = 'open' AND (r->>'epoch')::bigint = 1 AND (r->>'seq')::bigint = 7
     FROM ev WHERE nome = 'replay_estado'),
  'replay não move a marca d''água nem o estado da sessão');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'fora_de_ordem'), 'out_of_order',
  'seq menor com o mesmo epoch é fora de ordem');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'epoch_maior'), 'applied',
  'epoch MAIOR com seq MENOR é ACEITO — é o restart da VPS');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'qr_em_open'), 'transition_refused',
  'auth-state qr numa sessão open é recusado');

SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'qr_em_open_estado'), 'open',
  'a recusa do qr deixa a sessão open intacta');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'connected'), 'applied',
  'call-status connected é aplicado');

-- `connected_at` é a coluna que HOJE é sempre nula em produção: nada a escrevia.
-- ok(... IS NOT NULL), não is(): o is() do pgTAP usa NOT IS DISTINCT FROM, então
-- NULL = NULL passaria, e a asserção seria vacuamente verdadeira exatamente no
-- estado que ela existe para reprovar.
SELECT ok(
  (SELECT (r->>'connected_at') IS NOT NULL AND r->>'status' = 'connected'
     FROM ev WHERE nome = 'connected_linha'),
  'connected grava connected_at e promove o status');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'encerrada'), 'applied',
  'call-ended é aplicado');

SELECT ok(
  (SELECT (r->>'ended_at') IS NOT NULL AND r->>'status' = 'ended'
     FROM ev WHERE nome = 'encerrada_linha'),
  'call-ended grava ended_at e fecha a linha');

SELECT is((SELECT r->>'end_reason' FROM ev WHERE nome = 'encerrada_linha'), 'declined',
  'o end_reason gravado é o do payload');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'motivo_forjado'), 'applied',
  'call-ended com motivo desconhecido ainda fecha a linha');

SELECT is((SELECT r->>'end_reason' FROM ev WHERE nome = 'motivo_forjado_linha'), 'unknown',
  'motivo fora do conjunto fechado vira unknown — a VPS não escreve no_terminal_event');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'ressuscita'), 'applied',
  'connected numa linha fechada pelo varredor é aplicado');

SELECT is((SELECT r->>'detail' FROM ev WHERE nome = 'ressuscita'), 'resurrected',
  'e o detalhe diz explicitamente que foi ressurreição');

SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'ressuscita_linha'), 'connected',
  'a linha ressuscitada volta a connected');

SELECT ok(
  (SELECT (r->>'end_reason') IS NULL AND (r->>'ended_at') IS NULL
     FROM ev WHERE nome = 'ressuscita_linha'),
  'a ressurreição limpa end_reason E ended_at — linha viva com carimbo de fim é mentira');

-- Ressurreição sempre deixa rastro: ela significa que a entrega está mais lenta
-- que os 2 minutos do varredor. Sem o registro, o sintoma é invisível.
SELECT ok(
  EXISTS (SELECT 1 FROM public.runtime_logs l
           WHERE l.module = 'voip'
             AND l.action = 'webhook_chamada_ressuscitada'
             AND l.entity_id = 'c0000001-0000-0000-0000-000000000003'),
  'a ressurreição é registrada em runtime_logs');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'nao_ressuscita'), 'transition_refused',
  'connected numa linha fechada por user_ended é RECUSADO');

SELECT ok(
  (SELECT r->>'status' = 'ended' AND r->>'end_reason' = 'user_ended'
       AND (r->>'ended_at') IS NOT NULL
     FROM ev WHERE nome = 'nao_ressuscita_linha'),
  'quem desligou decidiu: a linha do operador fica intacta');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'operador_ocupado'), 'transition_refused',
  'ressurreição com o operador já ocupado é recusada');

SELECT is((SELECT r->>'detail' FROM ev WHERE nome = 'operador_ocupado'), 'operator_busy',
  'e o motivo da recusa é o operador ocupado, não outro');

SELECT ok(
  (SELECT r->>'status' = 'ended' AND r->>'end_reason' = 'no_terminal_event'
     FROM ev WHERE nome = 'operador_ocupado_linha'),
  'a linha recusada por operador ocupado não é alterada (o UNIQUE parcial estouraria)');

-- ===========================================================================
-- ANTI-REGRESSÃO DO CONTRATO COM O ENDPOINT (T8)
-- ===========================================================================
-- A tabela de roteamento HTTP da T8 casa por `code`. Um código novo, ou um
-- renomeado, cai no default e vira 200 ou 500 em silêncio. Estas asserções
-- amarram os seis nomes.
SELECT ok(
  (SELECT bool_and(r->>'code' IN ('applied','replay','out_of_order',
                                  'session_not_found','session_inert','transition_refused'))
     FROM ev WHERE r ? 'code'),
  'todo code devolvido pertence ao conjunto fechado que a T8 roteia');

SELECT ok(
  (SELECT bool_and((r->>'ok')::boolean) FROM ev
    WHERE r ? 'code' AND r->>'code' <> 'transition_refused'),
  'ok=true em tudo que é consumido sem anomalia');

SELECT ok(
  (SELECT bool_and(NOT (r->>'ok')::boolean) FROM ev
    WHERE r->>'code' = 'transition_refused'),
  'ok=false só em transition_refused — a única saída que merece olho humano');

-- ===========================================================================
-- ANTI-REPLAY: a reserva de jti é a primeira ESCRITA, e só ela
-- ===========================================================================
-- Sessão ausente e sessão em quarentena retornam ANTES de reservar o jti, de
-- propósito: a sessão pode nascer aqui depois, e nesse caso a retentativa TEM
-- que poder aplicar. Se a reserva subisse para antes desses dois testes, o
-- evento ficaria queimado para sempre.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.voip_webhook_events
               WHERE event_jti IN ('e0000000-0000-0000-0000-000000000001',
                                   'e0000000-0000-0000-0000-000000000002')),
  'sessão ausente/inerte NÃO queima o jti');

SELECT ok(
  EXISTS (SELECT 1 FROM public.voip_webhook_events
           WHERE event_jti = 'e0000000-0000-0000-0000-000000000011'),
  'evento fora de ordem QUEIMA o jti — retentar não mudaria o veredito');

SELECT ok(
  EXISTS (SELECT 1 FROM public.voip_webhook_events
           WHERE event_jti = 'e0000000-0000-0000-0000-000000000013'),
  'evento com transição recusada QUEIMA o jti — recusa é decisão, não falha');

SELECT ok(
  (SELECT count(*) = 1 FROM public.voip_webhook_events
    WHERE event_jti = 'e0000000-0000-0000-0000-000000000010'),
  'o jti repetido tem UMA linha só');

-- A organização NUNCA sai do corpo da requisição — sai de voip_sessions.
SELECT ok(
  (SELECT bool_and(organization_id = 'b1111111-1111-1111-1111-111111111111')
     FROM public.voip_webhook_events),
  'a organização gravada é a da sessão, derivada pelo tc_session_id');

-- A janela de dedup tem que cobrir o TTL do envelope (300 s) com folga.
SELECT ok(
  (SELECT bool_and(expires_at > received_at + interval '5 minutes')
     FROM public.voip_webhook_events),
  'a janela de dedup é maior que o TTL de 300 s do envelope');

SELECT * FROM finish();
ROLLBACK;

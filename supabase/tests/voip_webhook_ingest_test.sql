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
--  3. OS CINCO ESTADOS DE SESSÃO, não três. A VPS emite `connecting`
--     (session.go:170) e `failed` (session.go:190/192) além de
--     `qr`/`open`/`logged_out`, e o broker manda os dois ao CRM sem filtro
--     (broker.go:230). Descartar `failed` é o pior caso: é o sinal de sessão
--     morta, e o CRM seguiria marcando a sessão como `open` — a divergência de
--     estado que o S11 existe para acabar.
--
--  4. CARIMBO DE TEMPO DA VPS. `to_timestamp` LEVANTA para valor fora da faixa
--     do tipo, e a exceção aborta a transação inteira antes de o jti ser
--     reservado. A faixa tem que ser testada em milissegundos, antes de
--     converter.
--
--  5. A CORRIDA COM O VARREDOR, que é REAL: `voip-sweep-stuck-calls` fecha
--     `ringing` parado há mais de 2 minutos com `end_reason =
--     'no_terminal_event'` — 4 das 7 chamadas de produção hoje foram fechadas
--     por ele. Um `connected` entregue depois encontra a linha já `ended`.
--     Ressuscitar é certo quando quem fechou foi o VARREDOR; é errado quando
--     quem fechou foi o OPERADOR. E só é possível quando o operador não tem
--     outra chamada viva, porque `idx_voip_calls_one_live_per_operator` é
--     UNIQUE parcial e a escrita estouraria.
SELECT plan(87);

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

-- A marca d'água é POR ENTIDADE (achado I-1). Sem estas duas colunas, uma
-- sessão com N chamadas simultâneas divide um contador só, e o evento da
-- chamada A é descartado por causa de um evento da chamada B.
SELECT has_column('public'::name, 'voip_calls'::name, 'last_seq_epoch'::name,
  'voip_calls ganhou a marca d''água de epoch (ordem por chamada)');

SELECT has_column('public'::name, 'voip_calls'::name, 'last_seq'::name,
  'voip_calls ganhou a marca d''água de seq (ordem por chamada)');

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
   'sess-wh-busy',  'operador já ocupado',         'open'),
  -- A célula `closed` + `open` é nomeada pelo brief e não tinha teste: trocar o
  -- NULL por 'open' naquela linha deixava a suíte inteira verde.
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-closed', 'sessão encerrada',           'closed'),
  -- Os dois estados que a VPS emite e que o brief original não listava.
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-conn',  'reconectando (transitório)',  'open'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-fail',  'falha terminal',              'open'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-ts',    'carimbo fora de faixa',       'open'),
  -- Achado I-1: a numeração é ordenada, a ENTREGA não é.
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-late',  'entrega fora de ordem',       'open'),
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'sess-wh-multi', 'duas chamadas na sessão',     'open');

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
   now() - interval '1 minute', now() - interval '1 minute', now() - interval '50 seconds', NULL),

  -- Alvos do carimbo fora de faixa: uma recebe endedAt em NANOssegundos, a outra
  -- startedAt absurdamente negativo.
  ('c0000001-0000-0000-0000-000000000007', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-ts', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA07', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  ('c0000001-0000-0000-0000-000000000008', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-ts', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA08', NULL,
   '5548991005289', 'outbound', 'authorized', NULL,
   now() - interval '10 seconds', NULL, NULL, NULL),

  -- --- achado I-1: reordenação DENTRO da mesma chamada -------------------
  -- AA10 recebe `call-ended` (seq 2) e SÓ DEPOIS o `connected` (seq 1). Era o
  -- caso que deixava connected_at nulo para sempre.
  ('c0000001-0000-0000-0000-000000000010', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-late', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA10', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  -- AA11: `call-ended` depois de `call-ended`. Tem que continuar sem efeito.
  ('c0000001-0000-0000-0000-000000000011', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-late', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA11', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  -- AA14: `ringing` atrasado atrás do `connected`. Fase não retrocede, mas o
  -- carimbo que só o `ringing` carrega não pode sumir.
  ('c0000001-0000-0000-0000-000000000014', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-late', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14', NULL,
   '5548991005289', 'outbound', 'authorized', NULL,
   now() - interval '30 seconds', NULL, NULL, NULL),

  -- AA15: M-1 puro, SEM reordenação. connected_at é relógio do CRM; o `endedAt`
  -- do payload é relógio da VPS e chega ANTES dele. Sem o GREATEST a duração
  -- fica negativa (medido: -00:00:01.999797).
  ('c0000001-0000-0000-0000-000000000015', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-late', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA15', NULL,
   '5548991005289', 'outbound', 'connected', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', now(), NULL),

  -- --- achado I-1: duas chamadas dividindo UMA sessão --------------------
  -- Com marca d'água por sessão, AA13 (seq 4) era descartada só porque AA12
  -- (seq 5) tinha chegado antes. Não é reordenação: é interleaving.
  ('c0000001-0000-0000-0000-000000000012', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-multi', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA12', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  ('c0000001-0000-0000-0000-000000000013', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-multi', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA13', NULL,
   '5548991005289', 'outbound', 'ringing', NULL,
   now() - interval '30 seconds', now() - interval '28 seconds', NULL, NULL),

  -- AA16: chamada que JÁ conectou, com connected_at de 30 s atrás. Um
  -- `connected` tardio não pode reescrever carimbo preenchido (regra 3 da faixa
  -- tardia) — reescrever moveria o carimbo para `now()` e inventaria uma
  -- duração de chamada que não aconteceu.
  ('c0000001-0000-0000-0000-000000000016', 'b1111111-1111-1111-1111-111111111111',
   'sess-wh-late', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA16', NULL,
   '5548991005289', 'outbound', 'connected', NULL,
   now() - interval '40 seconds', now() - interval '35 seconds',
   now() - interval '30 seconds', NULL);

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

-- --- a célula `closed` + `open` (sess-wh-closed) ---------------------------
-- Reabrir exige parear de novo, e o pareamento passa por `qr`.
INSERT INTO ev VALUES ('closed_open', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000014', 'sess-wh-closed', 1, 1, now(),
  '{"type":"auth-state","sessionId":"sess-wh-closed","paired":true,"state":"open"}'::jsonb));

INSERT INTO ev VALUES ('closed_open_estado', (
  SELECT jsonb_build_object('status', s.status)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-closed'));

-- `connecting` também não é caminho de volta de sessão encerrada.
INSERT INTO ev VALUES ('closed_connecting', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000015', 'sess-wh-closed', 1, 2, now(),
  '{"type":"auth-state","sessionId":"sess-wh-closed","paired":false,"state":"connecting"}'::jsonb));

INSERT INTO ev VALUES ('closed_connecting_estado', (
  SELECT jsonb_build_object('status', s.status)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-closed'));

-- --- `connecting`: transitório, mas tem que tirar a sessão de `open` -------
-- session.go:170 emite isto em events.Disconnected. O comentário do Go
-- (session.go:166) diz por quê: sem sair de `open`, "o CRM continuaria
-- autorizando chamada para um número desconectado".
INSERT INTO ev VALUES ('connecting', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000016', 'sess-wh-conn', 1, 1, now(),
  '{"type":"auth-state","sessionId":"sess-wh-conn","paired":false,"state":"connecting"}'::jsonb));

INSERT INTO ev VALUES ('connecting_estado', (
  SELECT jsonb_build_object('status', s.status)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-conn'));

-- Segundo `connecting` seguido: no-op silencioso. Uma rede que pisca não pode
-- virar enxurrada em runtime_logs.
INSERT INTO ev VALUES ('connecting_repetido', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000017', 'sess-wh-conn', 1, 2, now(),
  '{"type":"auth-state","sessionId":"sess-wh-conn","paired":false,"state":"connecting"}'::jsonb));

INSERT INTO ev VALUES ('connecting_repetido_estado', (
  SELECT jsonb_build_object(
           'status', (SELECT s.status FROM public.voip_sessions s
                       WHERE s.tc_session_id = 'sess-wh-conn'),
           'logs',   (SELECT count(*) FROM public.runtime_logs l
                       WHERE l.module = 'voip'
                         AND l.action = 'webhook_sessao_reconectando'
                         AND l.entity_id = (SELECT s.id FROM public.voip_sessions s
                                             WHERE s.tc_session_id = 'sess-wh-conn')))));

-- --- `failed`: terminal, exige repareamento --------------------------------
-- session.go:190/192, de ConnectFailure e StreamReplaced. `closed` é o ÚNICO
-- estado que faz TorqueCallsSettings.tsx oferecer "Ativar voz" (o repareamento)
-- e devolver a vaga do teto.
INSERT INTO ev VALUES ('failed', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000018', 'sess-wh-fail', 1, 1, now(),
  '{"type":"auth-state","sessionId":"sess-wh-fail","paired":false,"state":"failed"}'::jsonb));

INSERT INTO ev VALUES ('failed_estado', (
  SELECT jsonb_build_object('status', s.status)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-fail'));

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

-- --- carimbo de tempo fora de faixa (sess-wh-ts) ---------------------------
-- 1753900000000000000 é o que sai de trocar UnixMilli() por UnixNano() no Go:
-- erro de unidade de UMA linha. Convertido cru, to_timestamp levanta 22008
-- (`timestamp out of range`), a transação inteira aborta, o jti NÃO chega a ser
-- reservado e a entrega vira 500 — o guard de faixa falhava aberto exatamente
-- nos extremos que ele existe para rejeitar.
INSERT INTO ev VALUES ('ts_nanos', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000040', 'sess-wh-ts', 1, 1, now(),
  '{"type":"call-ended","sessionId":"sess-wh-ts","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA07",
    "reason":"user_ended","endedAt":1753900000000000000}'::jsonb));

INSERT INTO ev VALUES ('ts_nanos_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA07'));

INSERT INTO ev VALUES ('ts_negativo', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000041', 'sess-wh-ts', 1, 2, now(),
  '{"type":"call-status","sessionId":"sess-wh-ts","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA08",
    "status":"ringing","direction":"inbound","peer":"5548991005289",
    "startedAt":-999999999999999999}'::jsonb));

INSERT INTO ev VALUES ('ts_negativo_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA08'));

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

-- --- achado I-1: a entrega chega fora de ordem -----------------------------
-- `now()` é transaction_timestamp() e vale o mesmo em toda a transação, então
-- `endedAt = now() - 2s` é exatamente 2 s ANTES do instante que a RPC usa para
-- carimbar `connected_at`. É o que torna a asserção de duração afiada: sem o
-- clamp ela dá -2 s, com o clamp dá 0.

-- AA10: o `call-ended` (seq 2) ganha a corrida...
INSERT INTO ev VALUES ('tardio_fim_primeiro', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000050', 'sess-wh-late', 1, 2, now(),
  jsonb_build_object('type','call-ended','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA10',
                     'reason','user_ended',
                     'endedAt',(extract(epoch from now()) * 1000)::bigint - 2000)));

-- ...e o `connected` (seq 1) chega DEPOIS. É a razão de existir da fatia:
-- connected_at é a medição que hoje é 0 em 7 chamadas de produção.
INSERT INTO ev VALUES ('tardio_connected', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000051', 'sess-wh-late', 1, 1, now(),
  '{"type":"call-status","sessionId":"sess-wh-late","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA10",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('tardio_connected_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA10'));

-- REGRA 1 da faixa tardia, medida por consequência e não só pela coluna: se o
-- evento tardio (seq 1) tivesse avançado a marca d'água, ela teria REBOBINADO
-- de 2 para 1 — e este seq 2, que a marca correta ainda barra, passaria a ser
-- aceito como se fosse novidade. Com a marca intacta ele é tardio, cai na faixa
-- e não acha carimbo a preencher (ringing_at veio da semente).
INSERT INTO ev VALUES ('rebobina_sonda', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000057', 'sess-wh-late', 1, 2, now(),
  '{"type":"call-status","sessionId":"sess-wh-late","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA10",
    "status":"ringing","direction":"outbound","peer":"5548991005289"}'::jsonb));

-- AA11: `call-ended` (seq 2) e depois OUTRO `call-ended` (seq 1, jti novo,
-- motivo diferente). O segundo não pode ter efeito nenhum.
INSERT INTO ev VALUES ('fim_primeiro', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000052', 'sess-wh-late', 1, 2, now(),
  jsonb_build_object('type','call-ended','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA11',
                     'reason','declined',
                     'endedAt',(extract(epoch from now()) * 1000)::bigint - 2000)));

INSERT INTO ev VALUES ('fim_tardio', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000053', 'sess-wh-late', 1, 1, now(),
  jsonb_build_object('type','call-ended','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA11',
                     'reason','timeout',
                     'endedAt',(extract(epoch from now()) * 1000)::bigint)));

INSERT INTO ev VALUES ('fim_tardio_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA11'));

-- AA14: `connected` (seq 3) e depois o `ringing` (seq 2).
INSERT INTO ev VALUES ('conn_antes_ring', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000054', 'sess-wh-late', 1, 3, now(),
  '{"type":"call-status","sessionId":"sess-wh-late","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('tardio_ringing', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000055', 'sess-wh-late', 1, 2, now(),
  jsonb_build_object('type','call-status','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14',
                     'status','ringing','direction','outbound','peer','5548991005289',
                     'startedAt',(extract(epoch from now()) * 1000)::bigint - 5000)));

INSERT INTO ev VALUES ('tardio_ringing_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14'));

-- REGRA 3 no sítio do `ringing`: agora que ringing_at está preenchido, um
-- SEGUNDO ringing atrasado (startedAt 60 s atrás) não pode reescrevê-lo.
INSERT INTO ev VALUES ('ring_ja_preenchido', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000058', 'sess-wh-late', 1, 1, now(),
  jsonb_build_object('type','call-status','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14',
                     'status','ringing','direction','outbound','peer','5548991005289',
                     'startedAt',(extract(epoch from now()) * 1000)::bigint - 60000)));

INSERT INTO ev VALUES ('ring_ja_preenchido_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA14'));

-- --- REGRA 3 no sítio do `connected` (AA16, connected_at já preenchido) -----
-- Primeiro o fim (seq 7) para que o `connected` seguinte seja tardio...
INSERT INTO ev VALUES ('conn_cheio_fim', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000059', 'sess-wh-late', 1, 7, now(),
  jsonb_build_object('type','call-ended','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA16',
                     'reason','user_ended',
                     'endedAt',(extract(epoch from now()) * 1000)::bigint)));

-- ...e agora o `connected` atrasado (seq 6) sobre um carimbo que JÁ existe.
INSERT INTO ev VALUES ('conn_cheio_tardio', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-00000000005a', 'sess-wh-late', 1, 6, now(),
  '{"type":"call-status","sessionId":"sess-wh-late","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA16",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('conn_cheio_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA16'));

-- AA15: M-1 sem reordenação nenhuma — só os dois relógios no mesmo cálculo.
INSERT INTO ev VALUES ('m1_relogios', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000056', 'sess-wh-late', 1, 4, now(),
  jsonb_build_object('type','call-ended','sessionId','sess-wh-late',
                     'id','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA15',
                     'reason','user_ended',
                     'endedAt',(extract(epoch from now()) * 1000)::bigint - 2000)));

INSERT INTO ev VALUES ('m1_relogios_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA15'));

-- --- achado I-1: duas chamadas, uma sessão ---------------------------------
INSERT INTO ev VALUES ('multi_alta', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000060', 'sess-wh-multi', 1, 5, now(),
  '{"type":"call-status","sessionId":"sess-wh-multi","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA12",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

-- seq MENOR, mas de OUTRA chamada: não é fora de ordem coisa nenhuma.
INSERT INTO ev VALUES ('multi_baixa', public.fn_voip_apply_vps_event(
  'e0000000-0000-0000-0000-000000000061', 'sess-wh-multi', 1, 4, now(),
  '{"type":"call-status","sessionId":"sess-wh-multi","id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA13",
    "status":"connected","direction":"outbound","peer":"5548991005289"}'::jsonb));

INSERT INTO ev VALUES ('multi_baixa_linha', (
  SELECT to_jsonb(c) FROM public.voip_calls c
   WHERE c.tc_call_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA13'));

-- A marca d'água DE SESSÃO não pode ter sido movida por evento de chamada.
INSERT INTO ev VALUES ('multi_sessao', (
  SELECT jsonb_build_object('epoch', s.last_seq_epoch, 'seq', s.last_seq)
    FROM public.voip_sessions s WHERE s.tc_session_id = 'sess-wh-multi'));

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

-- --- a célula que faltava e os dois estados que o brief não listava --------

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'closed_open'), 'transition_refused',
  'auth-state open numa sessão closed é recusado — reabrir passa por qr');

SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'closed_open_estado'), 'closed',
  'a recusa deixa a sessão closed intacta');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'closed_connecting'), 'transition_refused',
  'connecting numa sessão closed é recusado — não é caminho de volta');

SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'closed_connecting_estado'), 'closed',
  'e a sessão segue closed');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'connecting'), 'applied',
  'auth-state connecting é aplicado, não recusado com unknown_state');

-- O ponto INTEIRO de o Go emitir connecting: tirar a sessão de `open` para
-- fn_voip_call_reserve parar de autorizar chamada para um número desconectado.
SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'connecting_estado'), 'pending',
  'connecting tira a sessão de open (vira pending) — deixa de ser chamável');

SELECT ok(
  EXISTS (SELECT 1 FROM public.runtime_logs l
           WHERE l.module = 'voip'
             AND l.action = 'webhook_sessao_reconectando'
             AND l.entity_type = 'voip_session'),
  'a suspensão por connecting deixa rastro em runtime_logs');

SELECT ok(
  (SELECT r->>'status' = 'pending' AND (r->>'logs')::int = 1
     FROM ev WHERE nome = 'connecting_repetido_estado'),
  'connecting repetido é no-op silencioso — rede que pisca não vira enxurrada de log');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'failed'), 'applied',
  'auth-state failed é aplicado — é o sinal de sessão morta, não pode ser descartado');

-- `closed` é o único valor que faz TorqueCallsSettings.tsx trocar
-- "Aguardando confirmação" por "Ativar voz" e devolver a vaga do teto.
SELECT is((SELECT r->>'status' FROM ev WHERE nome = 'failed_estado'), 'closed',
  'failed leva a sessão a closed — o estado em que a tela oferece repareamento');

SELECT ok(
  EXISTS (SELECT 1 FROM public.runtime_logs l
           WHERE l.module = 'voip'
             AND l.action = 'webhook_sessao_falhou'
             AND l.status = 'error'
             AND l.entity_type = 'voip_session'),
  'failed deixa rastro próprio — a distinção que o Go faz contra logged_out não se perde');

-- --- carimbo fora de faixa ------------------------------------------------

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'ts_nanos'), 'applied',
  'endedAt em NANOssegundos não estoura a transação');

SELECT ok(
  (SELECT (r->>'ended_at')::timestamptz > now() - interval '1 minute'
      AND (r->>'ended_at')::timestamptz <= now()
      AND r->>'status' = 'ended'
     FROM ev WHERE nome = 'ts_nanos_linha'),
  'carimbo fora de faixa cai para o relógio do CRM, e a linha fecha assim mesmo');

-- A prova de que a transação SOBREVIVEU: com o guard falhando aberto, o 22008
-- abortava tudo e esta linha não existia.
SELECT ok(
  EXISTS (SELECT 1 FROM public.voip_webhook_events
           WHERE event_jti = 'e0000000-0000-0000-0000-000000000040'),
  'o jti do evento com carimbo absurdo foi reservado — nada abortou');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'ts_negativo'), 'applied',
  'startedAt absurdamente negativo não estoura a transação');

SELECT ok(
  (SELECT (r->>'ringing_at')::timestamptz > now() - interval '1 minute'
      AND r->>'status' = 'ringing'
     FROM ev WHERE nome = 'ts_negativo_linha'),
  'o ringing_at gravado é o relógio do CRM, não lixo do outro lado');

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
-- ACHADO I-1 — a numeração é ordenada, a ENTREGA não é
-- ===========================================================================
-- O emissor do Go despacha cada evento num `go func()` próprio (webhook.go:74),
-- sem fila e sem retentativa. Dois eventos emitidos com milissegundos de
-- diferença chegam na ordem que a rede quiser.

-- --- o caso que a fatia inteira existe para resolver ------------------------
SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'tardio_connected'), 'applied',
  'connected que chega DEPOIS do ended é consumido, não descartado');

SELECT is((SELECT r->>'detail' FROM ev WHERE nome = 'tardio_connected'), 'late_connected_at',
  'e ele é consumido pela faixa tardia, não pelo caminho normal');

SELECT ok(
  (SELECT (r->>'connected_at') IS NOT NULL FROM ev WHERE nome = 'tardio_connected_linha'),
  'connected_at É GRAVADO mesmo com o connected chegando fora de ordem — a medição que hoje é 0 em 7');

-- A outra metade da regra, e é ela que impede o remédio de virar doença.
SELECT ok(
  (SELECT r->>'status' = 'ended' AND r->>'end_reason' = 'user_ended'
     FROM ev WHERE nome = 'tardio_connected_linha'),
  'e o estado NÃO retrocede: a linha continua ended, com a causa que a VPS deu');

-- M-1 sob reordenação: `connected_at` sai do relógio do CRM e `ended_at` do
-- relógio da VPS. Sem o clamp isto dava -2 s.
SELECT ok(
  (SELECT (r->>'ended_at')::timestamptz >= (r->>'connected_at')::timestamptz
     FROM ev WHERE nome = 'tardio_connected_linha'),
  'a duração da chamada não fica NEGATIVA (connected_at é limitado por ended_at)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.runtime_logs l
           WHERE l.module = 'voip'
             AND l.action = 'webhook_carimbo_tardio'
             AND l.entity_id = 'c0000001-0000-0000-0000-000000000010'),
  'o carimbo tardio deixa rastro — entrega fora de ordem é fato operacional');

-- --- REGRA 1: a faixa tardia NÃO avança a marca d'água ---------------------
-- Sem estas duas, trocar `IF NOT v_late` por `IF true` passa verde: a marca
-- rebobina de 2 para 1 e o próximo evento velho entra como se fosse novo.
SELECT ok(
  (SELECT (r->>'last_seq_epoch')::bigint = 1 AND (r->>'last_seq')::bigint = 2
     FROM ev WHERE nome = 'tardio_connected_linha'),
  'o evento tardio NÃO rebobina a marca d''água da chamada (fica no seq 2 que já passou)');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'rebobina_sonda'), 'out_of_order',
  'e a marca intacta segue barrando o seq 2 — que uma marca rebobinada aceitaria');

-- --- REGRA 3: a faixa tardia só preenche o que está NULO -------------------
-- Sem estas quatro, remover o `IS NULL` de qualquer um dos dois sítios passa
-- verde, e um carimbo real é substituído por `now()`.
SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'conn_cheio_tardio'), 'out_of_order',
  'connected tardio sobre connected_at JÁ preenchido não tem o que preencher');

SELECT ok(
  (SELECT (r->>'connected_at')::timestamptz < now() - interval '20 seconds'
     FROM ev WHERE nome = 'conn_cheio_linha'),
  'e o connected_at verdadeiro (30 s atrás) NÃO é reescrito com now()');

SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'ring_ja_preenchido'), 'out_of_order',
  'ringing tardio sobre ringing_at JÁ preenchido também não tem o que preencher');

SELECT ok(
  (SELECT (r->>'ringing_at')::timestamptz > now() - interval '30 seconds'
     FROM ev WHERE nome = 'ring_ja_preenchido_linha'),
  'e o ringing_at existente NÃO é recuado para o startedAt do retardatário');

-- --- ended depois de ended: continua sem efeito nenhum ---------------------
SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'fim_tardio'), 'out_of_order',
  'call-ended depois de call-ended é fora de ordem');

SELECT ok(
  (SELECT r->>'status' = 'ended' AND r->>'end_reason' = 'declined'
     FROM ev WHERE nome = 'fim_tardio_linha'),
  'e não tem efeito: a causa VERDADEIRA que chegou primeiro não é sobrescrita');

SELECT ok(
  (SELECT (r->>'ended_at')::timestamptz < now() - interval '1 second'
     FROM ev WHERE nome = 'fim_tardio_linha'),
  'nem o carimbo de fim é remexido pelo retardatário');

-- --- ringing atrasado: fase não volta, carimbo não some --------------------
SELECT is((SELECT r->>'detail' FROM ev WHERE nome = 'tardio_ringing'), 'late_ringing_at',
  'ringing atrasado atrás do connected também cai na faixa tardia');

SELECT ok(
  (SELECT r->>'status' = 'connected' AND (r->>'ringing_at') IS NOT NULL
     FROM ev WHERE nome = 'tardio_ringing_linha'),
  'ringing_at é preenchido SEM rebaixar a chamada de connected para ringing');

-- --- M-1 puro, sem reordenação ---------------------------------------------
SELECT ok(
  (SELECT (r->>'ended_at')::timestamptz >= (r->>'connected_at')::timestamptz
     FROM ev WHERE nome = 'm1_relogios_linha'),
  'endedAt da VPS anterior ao connected_at do CRM não produz duração negativa');

-- --- duas chamadas dividindo uma sessão ------------------------------------
SELECT is((SELECT r->>'code' FROM ev WHERE nome = 'multi_baixa'), 'applied',
  'evento de seq MENOR de OUTRA chamada é aplicado — interleaving não é fora de ordem');

SELECT ok(
  (SELECT r->>'status' = 'connected' AND (r->>'connected_at') IS NOT NULL
     FROM ev WHERE nome = 'multi_baixa_linha'),
  'e ele aplica de verdade: a segunda chamada da sessão também carimba connected_at');

SELECT ok(
  (SELECT (r->>'epoch')::bigint = 0 AND (r->>'seq')::bigint = 0
     FROM ev WHERE nome = 'multi_sessao'),
  'evento de CHAMADA não move a marca d''água DA SESSÃO (senão auth-state seria a próxima vítima)');

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

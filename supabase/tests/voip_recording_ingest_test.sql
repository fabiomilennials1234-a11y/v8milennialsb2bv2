BEGIN;
-- Obrigatório, e tem que ser a PRIMEIRA linha depois do BEGIN. pgTAP não é
-- criado por migration nenhuma nem pelo config.toml, e como toda suíte roda
-- dentro de BEGIN/ROLLBACK ele nunca fica instalado entre arquivos.
CREATE EXTENSION IF NOT EXISTS pgtap;

-- A gravação da chamada chega ao CRM (Gravação S2, #1358 do PRD #1356).
-- Prova 20270803000000_voip_recording_ingest.sql.
--
-- A COSTURA É A REUSADA: o webhook do S11. Não há endpoint novo — `recording-
-- ready` e `recording-failed` entram por `fn_voip_apply_vps_event`, pelo mesmo
-- envelope assinado. É por isso que este arquivo dispara os eventos pela RPC de
-- verdade, e não chamando as funções de estado direto: o caminho de produção é
-- o da RPC, e testar o atalho provaria outra coisa.
--
-- O QUE ESTÁ EM JOGO, em ordem de gravidade:
--
--  1. MULTI-TENANCY. A gravação de uma organização não pode alcançar quem é de
--     outra. São DUAS barreiras, e as duas são testadas: a policy do bucket
--     (exercida como `authenticated`, nunca como superusuário) e o
--     `path_mismatch` de `fn_voip_recording_stored`, que recusa objeto composto
--     debaixo da pasta errada.
--
--  2. TRÊS ESTADOS, NÃO DOIS. `recording_url` vazio hoje significa "não
--     existe". Depois desta fatia precisa distinguir processando, pronta e
--     falhou — e AUSÊNCIA continua sendo um quarto estado, distinto de falha.
--     Colapsá-los é o defeito de produto: o gestor não sabe se espera ou se
--     desiste.
--
--  3. REENTREGA NÃO PIORA O QUE SE SABE. O anti-replay pelo `jti` NÃO cobre
--     este caso: a reentrega da VPS traz envelope NOVO, com jti novo. Quem
--     barra é o ESTADO. Uma gravação `ready` que voltasse a `processing`
--     mandaria o CRM rebuscar um arquivo que a VPS já apagou, e a segunda busca
--     marcaria FALHA numa gravação inteira.
--
--  4. O CARIMBO DE REGIME. Cada gravação registra que nasceu sem aviso ao lead
--     (ADR-0026 §9). É constante do CRM, e é IMUTÁVEL depois de posto — se a
--     política mudar, as antigas continuam distinguíveis das novas, que é o
--     ponto inteiro dele existir.
--
--  5. OS GRANTS. `REVOKE ... FROM PUBLIC` NÃO fecha função nova aqui: o
--     ALTER DEFAULT PRIVILEGES do Supabase concede EXECUTE a `anon` e
--     `authenticated` automaticamente. Os papéis têm que ser nomeados, e a
--     prova é `has_function_privilege`, não a leitura da migration.
--
--  6. O EVENTO ATRASADO AINDA APLICA. `recording-ready` é emitido depois do
--     `call-ended`, mas as duas entregas são goroutines independentes e sem
--     fila. Descartá-lo por chegar fora de ordem perderia a gravação inteira.
SELECT plan(83);

-- ===========================================================================
-- (0) ESTRUTURA E GRANTS
-- ===========================================================================
-- to_regprocedure em vez de has_function_privilege direto: antes da migration o
-- objeto não existe, e has_*_privilege ESTOURA com objeto ausente — com
-- ON_ERROR_STOP=1 (que o run.sh usa) o arquivo inteiro abortaria antes de
-- reportar um único `not ok`.

SELECT ok(
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'call-recordings'),
  'o bucket call-recordings existe');

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'call-recordings'),
  false,
  'o bucket é PRIVADO — os cinco existentes não serviam, e dois deles são públicos');

SELECT ok(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'call-recordings') > 64 * 1024 * 1024,
  'o teto do bucket fica ACIMA do teto do gravador da VPS (64 MiB) — quem recusa é quem sabe explicar');

SELECT is(
  (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'call-recordings'),
  ARRAY['audio/ogg'],
  'o bucket guarda UMA coisa: áudio Ogg. Aceitar mais seria depósito arbitrário atrás de policy de áudio');

SELECT has_column('public'::name, 'voip_calls'::name, 'recording_status'::name,
  'voip_calls ganhou o estado da gravação (a autoridade)');
SELECT has_column('public'::name, 'voip_calls'::name, 'recording_path'::name,
  'voip_calls ganhou o endereço do objeto');
SELECT has_column('public'::name, 'voip_calls'::name, 'recording_notice_regime'::name,
  'voip_calls ganhou o carimbo de regime — é ele que impede "por ora" de virar permanente');
SELECT has_column('public'::name, 'call_logs'::name, 'recording_status'::name,
  'call_logs ganhou o estado (a projeção — é daqui que o player da S3 lê)');
SELECT has_column('public'::name, 'call_logs'::name, 'recording_notice_regime'::name,
  'call_logs carrega o regime junto do áudio');

SELECT ok(
  to_regprocedure('public.fn_voip_can_hear_recording(text)') IS NOT NULL,
  'fn_voip_can_hear_recording existe');
SELECT ok(
  to_regprocedure('public.fn_voip_recording_announced(uuid,bigint,integer)') IS NOT NULL,
  'fn_voip_recording_announced existe');
SELECT ok(
  to_regprocedure('public.fn_voip_recording_stored(uuid,text,bigint)') IS NOT NULL,
  'fn_voip_recording_stored existe');
SELECT ok(
  to_regprocedure('public.fn_voip_recording_failed(uuid,text)') IS NOT NULL,
  'fn_voip_recording_failed existe');

-- O REVOKE de PUBLIC sozinho não fecha nada: o ALTER DEFAULT PRIVILEGES do
-- Supabase concede EXECUTE a anon e authenticated em toda função nova de
-- `public`. Estas quatro asserções são a prova de que os papéis foram nomeados.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_can_hear_recording(text)') IS NULL THEN false
       ELSE NOT has_function_privilege('anon', 'public.fn_voip_can_hear_recording(text)', 'EXECUTE') END,
  'anon NÃO executa fn_voip_can_hear_recording');

-- `authenticated` PRECISA executá-la: a policy do bucket é avaliada como o
-- usuário, e sem EXECUTE nenhuma leitura legítima passaria.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_can_hear_recording(text)') IS NULL THEN false
       ELSE has_function_privilege('authenticated', 'public.fn_voip_can_hear_recording(text)', 'EXECUTE') END,
  'authenticated executa fn_voip_can_hear_recording — a policy roda como o usuário');

SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon','authenticated','public']) r
    WHERE to_regprocedure('public.fn_voip_recording_stored(uuid,text,bigint)') IS NOT NULL
      AND has_function_privilege(r, 'public.fn_voip_recording_stored(uuid,text,bigint)', 'EXECUTE')),
  0,
  'nem anon nem authenticated escrevem o endereço da gravação');

SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_recording_stored(uuid,text,bigint)') IS NULL THEN false
       ELSE has_function_privilege('service_role', 'public.fn_voip_recording_stored(uuid,text,bigint)', 'EXECUTE') END,
  'service_role executa fn_voip_recording_stored — é a edge function que fecha o caminho');

-- `announced` NÃO vai para service_role: o único caminho legítimo é o evento
-- assinado, dentro da transação da RPC. Concedê-la abriria um jeito de marcar
-- `processing` sem envelope nenhum.
SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon','authenticated','service_role','public']) r
    WHERE to_regprocedure('public.fn_voip_recording_announced(uuid,bigint,integer)') IS NOT NULL
      AND has_function_privilege(r, 'public.fn_voip_recording_announced(uuid,bigint,integer)', 'EXECUTE')),
  0,
  'NENHUM papel do PostgREST marca `processing` — só o evento assinado chega lá');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
            AND polname = 'call_recordings_select'),
  'existe policy de SELECT no bucket');

-- A AUSÊNCIA É A DECISÃO: sem policy de escrita, um usuário logado não planta
-- objeto neste bucket. Se pudesse, escolheria a organização do caminho — e a
-- fronteira de tenant viraria escolha do atacante.
SELECT is(
  (SELECT count(*)::int FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND pg_get_expr(polqual, polrelid)      ILIKE '%call-recordings%'
      AND polcmd <> 'r'),
  0,
  'não há policy de INSERT/UPDATE/DELETE no bucket — só o service_role escreve');

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- `replica` desliga os triggers de negócio das tabelas de apoio
-- (trg_enforce_whatsapp_instance_limit chama assert_org_access e levanta
-- access_denied rodando como postgres sem JWT). Mesma técnica das outras suítes
-- de voz. CRÍTICO: volta para `origin` ANTES de escrever em voip_calls — é o
-- gatilho da projeção que está sob teste, e em `replica` ele não dispara.
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('2a000000-0000-0000-0000-0000000000a1', 'Org Gravacao A', 'org-gravacao-a'),
  ('2b000000-0000-0000-0000-0000000000b1', 'Org Gravacao B', 'org-gravacao-b');

INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES
  ('2a000000-0000-0000-0000-0000000000aa', '2a000000-0000-0000-0000-0000000000a1',
   'inst-gravacao-a', true, NULL),
  ('2b000000-0000-0000-0000-0000000000bb', '2b000000-0000-0000-0000-0000000000b1',
   'inst-gravacao-b', true, NULL);

INSERT INTO public.voip_sessions
  (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES
  ('2a000000-0000-0000-0000-0000000000a1', '2a000000-0000-0000-0000-0000000000aa',
   'sess-grav-a', 'TorqueCalls A', 'open'),
  ('2b000000-0000-0000-0000-0000000000b1', '2b000000-0000-0000-0000-0000000000bb',
   'sess-grav-b', 'TorqueCalls B', 'open');

INSERT INTO public.leads (id, organization_id, name, phone) VALUES
  ('2a000000-0000-0000-0000-0000000000e1', '2a000000-0000-0000-0000-0000000000a1',
   'Lead Gravacao A', '5548991005289'),
  ('2b000000-0000-0000-0000-0000000000e2', '2b000000-0000-0000-0000-0000000000b1',
   'Lead Gravacao B', '5548991005290');

-- Quatro pessoas, e cada uma existe para uma pergunta diferente:
--   vendedor  — fez a chamada 1. Ouve a própria, e SÓ a própria.
--   colega    — mesma org, não fez nada. Colega não ouve colega.
--   admin     — mesma org. Ouve tudo da organização.
--   forasteiro— org B. Não ouve nada da org A, com endereço em mãos ou sem.
INSERT INTO auth.users (id, email) VALUES
  ('2a000000-0000-0000-0000-000000000001', 'vendedor@gravacao.test'),
  ('2a000000-0000-0000-0000-000000000002', 'colega@gravacao.test'),
  ('2a000000-0000-0000-0000-000000000003', 'admin@gravacao.test'),
  ('2b000000-0000-0000-0000-000000000004', 'forasteiro@gravacao.test'),
  ('2a000000-0000-0000-0000-000000000005', 'desativado@gravacao.test');

INSERT INTO public.team_members (organization_id, user_id, name, role, is_active) VALUES
  ('2a000000-0000-0000-0000-0000000000a1', '2a000000-0000-0000-0000-000000000001',
   'Vendedor', 'member', true),
  ('2a000000-0000-0000-0000-0000000000a1', '2a000000-0000-0000-0000-000000000002',
   'Colega', 'member', true),
  ('2a000000-0000-0000-0000-0000000000a1', '2a000000-0000-0000-0000-000000000003',
   'Admin', 'admin', true),
  ('2b000000-0000-0000-0000-0000000000b1', '2b000000-0000-0000-0000-000000000004',
   'Forasteiro', 'admin', true),
  -- O membro DESATIVADO que fez a chamada 1: o furo do #1209 em outra roupa.
  ('2a000000-0000-0000-0000-0000000000a1', '2a000000-0000-0000-0000-000000000005',
   'Desativado', 'member', false);

SET LOCAL session_replication_role = origin;

-- As chamadas. Todas ATENDIDAS e ENCERRADAS: só chamada com conversa gera
-- gravação, e só chamada encerrada é projetada.
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status, authorized_at, ringing_at, connected_at, ended_at, end_reason)
VALUES
  -- 1: a chamada do vendedor, na org A
  ('c2000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-0000000000a1',
   'sess-grav-a', 'GRAVACAO000000000000000000000001', '2a000000-0000-0000-0000-0000000000e1',
   '2a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '6 minutes', 'user_ended'),
  -- 2: outra chamada da org A, para o caso de falha
  ('c2000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-0000000000a1',
   'sess-grav-a', 'GRAVACAO000000000000000000000002', '2a000000-0000-0000-0000-0000000000e1',
   '2a000000-0000-0000-0000-000000000002', '5548991005289', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '7 minutes', 'user_ended'),
  -- 3: reentrega / ordem
  ('c2000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-0000000000a1',
   'sess-grav-a', 'GRAVACAO000000000000000000000003', '2a000000-0000-0000-0000-0000000000e1',
   '2a000000-0000-0000-0000-000000000003', '5548991005289', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '8 minutes', 'user_ended'),
  -- 4: a chamada da ORG B — o alvo cross-tenant
  ('c2000000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-0000000000b1',
   'sess-grav-b', 'GRAVACAO000000000000000000000004', '2b000000-0000-0000-0000-0000000000e2',
   '2b000000-0000-0000-0000-000000000004', '5548991005290', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '5 minutes', 'user_ended'),
  -- 5: a chamada do membro DESATIVADO
  ('c2000000-0000-0000-0000-000000000005', '2a000000-0000-0000-0000-0000000000a1',
   'sess-grav-a', 'GRAVACAO000000000000000000000005', '2a000000-0000-0000-0000-0000000000e1',
   '2a000000-0000-0000-0000-000000000005', '5548991005289', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '4 minutes', 'user_ended');

-- ===========================================================================
-- (1) ANTES DO EVENTO: AUSÊNCIA, E AUSÊNCIA SÓ
-- ===========================================================================
-- Este é o estado de TODA chamada de produção hoje, e é o que não pode ser
-- confundido com falha.
SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  NULL,
  'chamada sem evento de gravação nasce em AUSÊNCIA (recording_status NULO)');

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  NULL,
  'e a projeção também: ausência atravessa até call_logs sem virar outra coisa');

-- ===========================================================================
-- (2) O EVENTO DE GRAVAÇÃO PRONTA — pelo caminho REAL, a RPC do webhook
-- ===========================================================================
SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000001'::uuid, 'sess-grav-a', 1, 10, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-a',
                        'id','GRAVACAO000000000000000000000001',
                        'bytes', 720000, 'durationMs', 180000,
                        'format','ogg/opus','channels',2)
   )->>'code'),
  'applied',
  'recording-ready é aceito por fn_voip_apply_vps_event — sem endpoint novo');

SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000002'::uuid, 'sess-grav-a', 1, 11, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-a',
                        'id','GRAVACAO000000000000000000000001',
                        'bytes', 720000, 'durationMs', 180000)
   )->>'code'),
  'applied',
  'a segunda entrega também é consumida (o jti é outro; quem barra é o estado)');

-- O estado intermediário existe, e é o que responde "espere" em vez de
-- "desista".
SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  'processing',
  'o anúncio marca PROCESSANDO — o CRM sabe que existe e está buscando');

SELECT is(
  (SELECT recording_bytes FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  720000::bigint,
  'o tamanho anunciado é guardado (história 18: medir o custo em disco com número)');

SELECT is(
  (SELECT recording_duration_ms FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  180000,
  'a duração da gravação é guardada (história 24: bater com a duração da chamada)');

-- O CARIMBO DE REGIME. Sem ele, "por ora" vira permanente por omissão.
SELECT is(
  (SELECT recording_notice_regime FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  'no_notice',
  'a gravação nasce carimbada: SEM aviso ao lead (ADR-0026 §9)');

-- A instrução de busca, que é como o endpoint sabe que precisa ir à VPS.
SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000003'::uuid, 'sess-grav-a', 1, 12, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-a',
                        'id','GRAVACAO000000000000000000000003',
                        'bytes', 1000, 'durationMs', 5000)
   ) - 'ok' - 'code' - 'detail' - 'recording'),
  jsonb_build_object(
    'fetch_call_id',   'c2000000-0000-0000-0000-000000000003',
    'tc_call_id',      'GRAVACAO000000000000000000000003',
    'organization_id', '2a000000-0000-0000-0000-0000000000a1'),
  'a saída traz os três campos da busca — e a organização vem da SESSÃO, nunca do corpo');

-- ===========================================================================
-- (3) O ENDEREÇO É GRAVADO — e o caminho é conferido contra a linha
-- ===========================================================================
SELECT is(
  public.fn_voip_recording_stored(
    'c2000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
    720000),
  'stored',
  'o caminho correto é aceito');

SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  'ready',
  'a gravação vira PRONTA');

SELECT is(
  (SELECT recording_path FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
  'o endereço é o caminho do objeto, não uma URL assinada (assinatura expira)');

-- A ÚLTIMA BARREIRA ANTES DE O ENDEREÇO VIRAR PERMANENTE. Se a edge function
-- errasse a organização, o objeto ficaria debaixo da pasta de outro tenant — e
-- a policy do bucket concederia a leitura a quem não deve.
SELECT is(
  public.fn_voip_recording_stored(
    'c2000000-0000-0000-0000-000000000002',
    '2b000000-0000-0000-0000-0000000000b1/c2000000-0000-0000-0000-000000000002.opus',
    1000),
  'path_mismatch',
  'caminho com a ORGANIZAÇÃO ERRADA é RECUSADO — é o vetor cross-tenant do bucket');

SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000002'),
  NULL,
  'e a recusa não deixa rastro de estado: nada foi escrito');

SELECT is(
  public.fn_voip_recording_stored(
    'c2000000-0000-0000-0000-000000000002',
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000003.opus',
    1000),
  'path_mismatch',
  'caminho com a CHAMADA ERRADA também é recusado');

-- ===========================================================================
-- (4) A PROJEÇÃO LEVA O ENDEREÇO ATÉ call_logs
-- ===========================================================================
-- É de `call_logs` que o player da S3 vai ler. Sem o gatilho reagindo às
-- colunas de gravação, o endereço ficaria na tabela de autoridade e nunca
-- chegaria à tela.
SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
  'o endereço chega a call_logs — o gatilho reage às colunas de gravação');

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  'ready',
  'e o estado junto');

SELECT is(
  (SELECT recording_notice_regime FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  'no_notice',
  'e o carimbo de regime junto: o registro diz sob qual política nasceu');

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  1,
  'UMA linha, não duas: a projeção corrige no lugar');

-- A projeção roda em TODA mudança relevante da chamada, inclusive nas que não
-- têm nada a ver com gravação. Sem o COALESCE do DO UPDATE, uma correção de
-- `end_reason` chegando depois do upload APAGARIA o endereço do áudio.
UPDATE public.voip_calls SET end_reason = 'declined'
 WHERE id = 'c2000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
  'uma correção do motivo de encerramento NÃO apaga o endereço do áudio');

-- ===========================================================================
-- (5) REENTREGA NÃO DUPLICA NEM SOBRESCREVE COM DADO PIOR
-- ===========================================================================
-- Envelope NOVO (jti novo), evento repetido. O anti-replay não pega; quem pega
-- é o estado.
SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000010'::uuid, 'sess-grav-a', 1, 20, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-a',
                        'id','GRAVACAO000000000000000000000001',
                        'bytes', 999, 'durationMs', 1)
   )->>'recording'),
  'already_stored',
  'a reentrega sobre gravação PRONTA devolve already_stored');

SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000011'::uuid, 'sess-grav-a', 1, 21, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-a',
                        'id','GRAVACAO000000000000000000000001',
                        'bytes', 999)
   )->'fetch_call_id'),
  'null'::jsonb,
  'e NÃO manda rebuscar: o arquivo pode já ter sido apagado da VPS');

SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  'ready',
  'PRONTA não é rebaixada para processando por uma reentrega');

SELECT is(
  (SELECT recording_bytes FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000001'),
  720000::bigint,
  'e o tamanho verdadeiro não é sobrescrito pelo do evento repetido');

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  1,
  'seguem UMA linha em call_logs depois de três entregas');

-- Guardar de novo é inofensivo, e não move o carimbo de quando foi guardada.
SELECT is(
  public.fn_voip_recording_stored(
    'c2000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
    720000),
  'stored',
  'guardar de novo o mesmo caminho é idempotente');

-- ===========================================================================
-- (6) DOWNLOAD QUE FALHA MARCA FALHA, NÃO AUSÊNCIA
-- ===========================================================================
-- É a distinção de produto inteira: com uma só, o gestor não sabe se espera ou
-- se desiste.
SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000020'::uuid, 'sess-grav-a', 1, 30, now(),
     jsonb_build_object('type','recording-failed','sessionId','sess-grav-a',
                        'id','GRAVACAO000000000000000000000002',
                        'reason','encoder_broken')
   )->>'code'),
  'applied',
  'recording-failed é aceito pela mesma RPC');

SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000002'),
  'failed',
  'FALHOU, e não ausente — quem procurar a gravação sabe que pode desistir');

SELECT is(
  (SELECT recording_failure_reason FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000002'),
  'encoder_broken',
  'com a CAUSA: "falhou" sem causa manda o plantonista olhar o lugar errado');

SELECT isnt(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000002'),
  NULL,
  'falha NUNCA colapsa em ausência');

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000002'),
  'failed',
  'e a falha chega à tela pela projeção');

-- A falha também carimba o regime: mesmo sem áudio, sabe-se sob qual política a
-- tentativa aconteceu.
SELECT is(
  (SELECT recording_notice_regime FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000002'),
  'no_notice',
  'a falha também é carimbada');

-- E o caminho da EDGE FUNCTION: a busca que não completa chama a mesma função.
SELECT is(
  public.fn_voip_recording_failed('c2000000-0000-0000-0000-000000000003', 'vps_http_404'),
  'failed',
  'a busca que falha no CRM usa a MESMA função — uma regra, dois chamadores');

SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000003'),
  'failed',
  'e o registro sai de processando para falhou, nunca de volta para ausente');

-- O COALESCE do DO UPDATE, exercido onde ele de fato morde.
--
-- A chamada 3 falhou, então `recording_path` é NULO e a projeção não tem
-- endereço para escrever. Se o DO UPDATE atribuísse `EXCLUDED.recording_url`
-- cru, a próxima reprojeção — provocada por QUALQUER mudança da chamada —
-- apagaria o que estivesse escrito ali. É a mesma intenção que a migration do
-- S13 declarou ao manter `recording_url` fora do DO UPDATE: a projeção não
-- inventa conteúdo e não apaga o que outro escreveu.
UPDATE public.call_logs SET recording_url = 'escrito-por-outro-caminho'
 WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000003';

UPDATE public.voip_calls SET end_reason = 'timeout'
 WHERE id = 'c2000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000003'),
  'escrito-por-outro-caminho',
  'a reprojeção NÃO apaga um endereço que a projeção não tinha para escrever');

-- Motivo vazio não vira silêncio.
SELECT is(
  public.fn_voip_recording_failed('c2000000-0000-0000-0000-000000000005', '   '),
  'failed',
  'motivo em branco ainda é falha');

SELECT is(
  (SELECT recording_failure_reason FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000005'),
  'unknown',
  'e o motivo em branco vira `unknown`, não NULO');

-- UMA GRAVAÇÃO PRONTA NÃO "FALHA" DEPOIS. Uma entrega atrasada de
-- recording-failed não pode apagar o endereço de um arquivo que toca.
SELECT is(
  public.fn_voip_recording_failed('c2000000-0000-0000-0000-000000000001', 'encoder_broken'),
  'already_stored',
  'gravação já guardada não é rebaixada para falha');

SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'c2000000-0000-0000-0000-000000000001'),
  '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
  'e o endereço continua lá');

-- ===========================================================================
-- (7) O EVENTO ATRASADO AINDA APLICA
-- ===========================================================================
-- `recording-ready` é emitido DEPOIS do `call-ended`, mas as duas entregas
-- partem em goroutines independentes e sem fila. Descartar o anúncio por chegar
-- fora de ordem perderia a gravação inteira — é a única coisa que ele carrega.
--
-- A chamada 4 (org B) recebe primeiro um evento com seq ALTO, e só depois o
-- anúncio da gravação com seq MENOR.
SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000030'::uuid, 'sess-grav-b', 1, 900, now(),
     jsonb_build_object('type','call-ended','sessionId','sess-grav-b',
                        'id','GRAVACAO000000000000000000000004','reason','user_ended')
   )->>'code'),
  'applied',
  'o call-ended com seq alto move a marca d''água da chamada');

SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000031'::uuid, 'sess-grav-b', 1, 5, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-b',
                        'id','GRAVACAO000000000000000000000004',
                        'bytes', 500000, 'durationMs', 240000)
   )->>'recording'),
  'fetch',
  'o anúncio ATRASADO ainda manda buscar — descartá-lo perderia a gravação inteira');

SELECT is(
  (SELECT recording_status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000004'),
  'processing',
  'e o estado é aplicado mesmo fora de ordem');

-- Mas o evento atrasado NÃO move a marca d'água — regra 1 da faixa tardia.
SELECT is(
  (SELECT last_seq FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000004'),
  900::bigint,
  'o anúncio atrasado NÃO avança a marca d''água');

-- Nem toca o status da chamada — regra 2.
SELECT is(
  (SELECT status FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000004'),
  'ended',
  'e NUNCA escreve o status da chamada');

-- Números malformados não derrubam a transação: um cast que estoura abortaria
-- tudo e devolveria 500 por payload ruim da VPS.
SELECT is(
  (SELECT public.fn_voip_apply_vps_event(
     '11111111-0000-0000-0000-000000000032'::uuid, 'sess-grav-b', 1, 901, now(),
     jsonb_build_object('type','recording-ready','sessionId','sess-grav-b',
                        'id','GRAVACAO000000000000000000000004',
                        'bytes','isto-nao-e-numero','durationMs', 999999999999999)
   )->>'code'),
  'applied',
  'bytes não-numérico e durationMs absurdo NÃO derrubam a transação');

SELECT is(
  (SELECT recording_bytes FROM public.voip_calls WHERE id = 'c2000000-0000-0000-0000-000000000004'),
  500000::bigint,
  'e o valor bom que já estava lá não é apagado pelo lixo do evento seguinte');

-- ===========================================================================
-- (8) QUEM OUVE — exercido como `authenticated`, NUNCA como superusuário
-- ===========================================================================
-- `postgres` bypassa RLS e produz falso verde. Estas asserções chamam a função
-- que a policy chama, com o `auth.uid()` de cada pessoa.

-- Guarda a policy contra a hipótese de o teste medir a coisa errada: sem RLS
-- ligada em storage.objects, nada do que vem abaixo significa alguma coisa.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
  'storage.objects tem RLS habilitada — sem isso a policy é decoração');

SET LOCAL ROLE authenticated;

-- O vendedor que FEZ a chamada 1.
SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(
  public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus'),
  'o vendedor ouve a PRÓPRIA gravação — é o que faz virar autocorreção, não vigilância');

SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000002.opus'),
  'e NÃO ouve a do colega: conversa com cliente não é material de time');

-- O colega, que não fez nada.
SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus'),
  'colega não ouve colega');

-- O admin da organização.
SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT ok(
  public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus'),
  'o admin ouve qualquer ligação da organização (investigar reclamação de cliente)');

-- O FORASTEIRO: admin da org B, com o endereço do objeto da org A em mãos.
SET LOCAL request.jwt.claims = '{"sub":"2b000000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus'),
  'gravação de outra organização NÃO alcança este bucket, nem com o endereço em mãos');

-- O CAMINHO NÃO É AUTORIDADE: pendurar a chamada alheia debaixo da PRÓPRIA
-- pasta não concede nada. Sem esta comparação, quem pudesse escrever um objeto
-- escolheria a org do path e leria a gravação de qualquer tenant.
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2b000000-0000-0000-0000-0000000000b1/c2000000-0000-0000-0000-000000000001.opus'),
  'a org do CAMINHO não manda: o que vale é a org da linha da chamada');

-- O membro DESATIVADO que fez a chamada 5. É o furo do #1209 nesta roupa: ele
-- perdeu o acesso à organização, e não pode continuar ouvindo o que gravou.
SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000005","role":"authenticated"}';
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000005.opus'),
  'membro DESATIVADO não ouve nem a própria gravação');

-- Fail-closed em tudo que não é um nome de objeto válido.
SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT ok(
  NOT public.fn_voip_can_hear_recording('lixo'),
  'nome malformado é recusado, não erro');
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/nao-e-uuid.opus'),
  'chamada que não é uuid é recusada');
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '2a000000-0000-0000-0000-0000000000a1/99999999-9999-4999-8999-999999999999.opus'),
  'chamada inexistente é recusada');
SELECT ok(
  NOT public.fn_voip_can_hear_recording(''),
  'nome vazio é recusado');

RESET ROLE;

-- ===========================================================================
-- (9) A POLICY DE VERDADE, contra storage.objects
-- ===========================================================================
-- As asserções acima provam a REGRA; estas provam a FIAÇÃO. Uma regra correta
-- pendurada na policy errada (ou em policy nenhuma) passaria em tudo acima e
-- entregaria o acervo inteiro — e é exatamente o tipo de defeito que só
-- aparece quando o teste faz um SELECT de verdade, como `authenticated`.
INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES
  ('call-recordings',
   '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000001.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb),
  ('call-recordings',
   '2a000000-0000-0000-0000-0000000000a1/c2000000-0000-0000-0000-000000000002.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb),
  ('call-recordings',
   '2b000000-0000-0000-0000-0000000000b1/c2000000-0000-0000-0000-000000000004.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb);

SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  1,
  'o vendedor ENXERGA exatamente 1 objeto no bucket: o da própria ligação');

SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  2,
  'o admin enxerga as DUAS da organização dele — e não a da org B');

SET LOCAL request.jwt.claims = '{"sub":"2b000000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'
     AND name LIKE '2a000000%'),
  0,
  'o admin da org B não enxerga NENHUM objeto da org A');

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  1,
  'e enxerga só o da própria organização');

-- E ninguém logado ESCREVE no bucket. Se pudesse, escolheria a organização do
-- caminho — e a fronteira de tenant viraria escolha do atacante.
SET LOCAL request.jwt.claims = '{"sub":"2a000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  $ins$INSERT INTO storage.objects (bucket_id, name, owner, metadata)
       VALUES ('call-recordings',
               '2b000000-0000-0000-0000-0000000000b1/c2000000-0000-0000-0000-000000000004.opus',
               NULL, '{}'::jsonb)$ins$,
  '42501',
  NULL,
  'nem o admin planta objeto no bucket — só o service_role escreve');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

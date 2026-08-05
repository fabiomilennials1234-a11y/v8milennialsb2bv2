BEGIN;
-- Obrigatório, e tem que ser a PRIMEIRA linha depois do BEGIN. pgTAP não é
-- criado por migration nenhuma nem pelo config.toml, e como toda suíte roda
-- dentro de BEGIN/ROLLBACK ele nunca fica instalado entre arquivos.
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Ouvir a gravação no CRM (Gravação S3, #1359 do PRD #1356).
-- Prova a POLICY DE LEITURA do bucket `call-recordings` e
-- 20270804000000_voip_recording_failure_reason_projection.sql.
--
-- ── Por que este arquivo existe se a S2 já testou a regra ──
-- A S2 (`voip_recording_ingest_test.sql`) prova a regra do lado de QUEM ESCREVE:
-- o evento chega, o arquivo é guardado, o caminho é conferido. Este arquivo
-- prova o lado de QUEM OUVE, que é o caminho que o player percorre — um SELECT
-- em `storage.objects`, como `authenticated`, exatamente como o storage-api faz
-- ao cunhar uma URL assinada.
--
-- E prova o caso que a S2 não cobre: o GESTOR (ADR-0021). Ele não é
-- `team_members.role = 'admin'` — chega por `gestores` + `gestor_organizations`,
-- e só alcança a organização porque `get_my_admin_organization_ids()` faz UNION
-- com `get_my_gestor_organization_ids()`. Um refactor que trocasse a função por
-- um `role = 'admin'` inline passaria em toda a suíte da S2 e tiraria do gestor
-- o acesso que a fatia inteira existe para dar.
--
-- ── O QUE ESTÁ EM JOGO, em ordem de gravidade ──
--
--  1. COLEGA NÃO OUVE COLEGA. É a história 9 do PRD, e é a única linha do
--     produto em que o vendedor é protegido dos PARES dele, não de fora. A
--     regra DIVERGE de propósito de `voip_can_see_call`: aquela amarra ao lead,
--     e um lead reatribuído tiraria do vendedor a gravação da ligação que ele
--     mesmo fez.
--
--  2. NINGUÉM DE FORA ALCANÇA, NEM COM O CAMINHO EM MÃOS. História 16. São
--     dois vetores: pedir o objeto alheio pelo nome dele, e pendurar a chamada
--     alheia debaixo da PRÓPRIA pasta.
--
--  3. EXERCIDO COMO `authenticated`. `postgres` bypassa RLS e produz falso
--     verde. Todo SELECT abaixo roda com `SET LOCAL ROLE authenticated` e um
--     `request.jwt.claims` de gente de verdade.
--
--  4. GRANT DE FUNÇÃO NÃO É COBERTO PELA REDE GERAL. Medido na S2: o mutante
--     que concedia `EXECUTE` a `anon` em `fn_voip_can_hear_recording` deixou o
--     `rls_invariants` VERDE. A asserção tem que ser específica, e é.
--
--  5. A CAUSA CHEGA À TELA, E COLADA AO ESTADO. Falha sem causa é uma parede
--     muda; causa que sobrevive à recuperação (`failed` → `ready`) é pior — a
--     tela diria "pronta" e "falhou por tempo esgotado" na mesma linha.
SELECT plan(41);

-- ===========================================================================
-- (0) A FIAÇÃO — sem ela nada abaixo significa coisa alguma
-- ===========================================================================
-- to_regprocedure/EXISTS em vez de has_*_privilege direto: antes da migration o
-- objeto não existe e has_*_privilege ESTOURA, o que com ON_ERROR_STOP=1
-- abortaria o arquivo antes de reportar um único `not ok`.

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
  'storage.objects tem RLS habilitada — sem isso a policy é decoração');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
            AND polname = 'call_recordings_select'),
  'a policy de leitura do bucket existe');

SELECT is(
  (SELECT polcmd::text FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
     AND polname = 'call_recordings_select'),
  'r',
  'e é SÓ de leitura: quem escreve é o service_role, que bypassa RLS');

-- O bucket é privado. Um bucket público tornaria a policy irrelevante — o
-- objeto sairia por `/object/public/` sem passar por RLS nenhuma.
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'call-recordings'),
  false,
  'o bucket é PRIVADO — com ele público a policy não seria consultada');

-- O GRANT ESPECÍFICO. A rede geral (`rls_invariants`) não pega isto: medido na
-- S2, o mutante que dava EXECUTE a `anon` passou verde por lá.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_can_hear_recording(text)') IS NULL THEN false
       ELSE NOT has_function_privilege('anon', 'public.fn_voip_can_hear_recording(text)', 'EXECUTE') END,
  'anon NÃO executa fn_voip_can_hear_recording — quem não fez login não ouve nada');

SELECT ok(
  CASE WHEN to_regprocedure('public.fn_voip_can_hear_recording(text)') IS NULL THEN false
       ELSE has_function_privilege('authenticated', 'public.fn_voip_can_hear_recording(text)', 'EXECUTE') END,
  'authenticated executa — a policy do bucket é avaliada COMO O USUÁRIO');

-- A coluna que o player lê para dizer POR QUE falhou.
SELECT has_column('public', 'call_logs', 'recording_failure_reason',
  'call_logs guarda a causa da falha — sem ela "falhou" na tela é parede muda');

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- `replica` desliga os triggers de negócio das tabelas de apoio
-- (trg_enforce_whatsapp_instance_limit chama assert_org_access e levanta
-- access_denied rodando como postgres sem JWT). CRÍTICO: volta para `origin`
-- ANTES de escrever em voip_calls — é o gatilho da projeção que está sob teste.
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('3a000000-0000-0000-0000-0000000000a1', 'Org Player A', 'org-player-a'),
  ('3b000000-0000-0000-0000-0000000000b1', 'Org Player B', 'org-player-b');

INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES
  ('3a000000-0000-0000-0000-0000000000aa', '3a000000-0000-0000-0000-0000000000a1',
   'inst-player-a', true, NULL),
  ('3b000000-0000-0000-0000-0000000000bb', '3b000000-0000-0000-0000-0000000000b1',
   'inst-player-b', true, NULL);

INSERT INTO public.voip_sessions
  (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES
  ('3a000000-0000-0000-0000-0000000000a1', '3a000000-0000-0000-0000-0000000000aa',
   'sess-player-a', 'TorqueCalls A', 'open'),
  ('3b000000-0000-0000-0000-0000000000b1', '3b000000-0000-0000-0000-0000000000bb',
   'sess-player-b', 'TorqueCalls B', 'open');

INSERT INTO public.leads (id, organization_id, name, phone) VALUES
  ('3a000000-0000-0000-0000-0000000000e1', '3a000000-0000-0000-0000-0000000000a1',
   'Lead Player A', '5548991005291'),
  ('3b000000-0000-0000-0000-0000000000e2', '3b000000-0000-0000-0000-0000000000b1',
   'Lead Player B', '5548991005292');

-- Seis pessoas, e cada uma responde a uma pergunta da fatia:
--   vendedor   — fez a chamada 1. Ouve a própria e SÓ a própria.
--   colega     — mesma org, fez a chamada 2. Não ouve a do vendedor.
--   admin      — mesma org, `team_members.role = 'admin'`. Ouve tudo da org.
--   gestor     — NÃO é team_member da org A. Chega por `gestores` +
--                `gestor_organizations` (ADR-0021). Ouve tudo da org A.
--   forasteiro — admin da org B, com o caminho do objeto da org A em mãos.
--   desativado — fez a chamada 5 e depois saiu. Não ouve nem a própria.
INSERT INTO auth.users (id, email) VALUES
  ('3a000000-0000-0000-0000-000000000001', 'vendedor@player.test'),
  ('3a000000-0000-0000-0000-000000000002', 'colega@player.test'),
  ('3a000000-0000-0000-0000-000000000003', 'admin@player.test'),
  ('3c000000-0000-0000-0000-000000000006', 'gestor@player.test'),
  ('3b000000-0000-0000-0000-000000000004', 'forasteiro@player.test'),
  ('3a000000-0000-0000-0000-000000000005', 'desativado@player.test');

INSERT INTO public.team_members (organization_id, user_id, name, role, is_active) VALUES
  ('3a000000-0000-0000-0000-0000000000a1', '3a000000-0000-0000-0000-000000000001',
   'Vendedor', 'member', true),
  ('3a000000-0000-0000-0000-0000000000a1', '3a000000-0000-0000-0000-000000000002',
   'Colega', 'member', true),
  ('3a000000-0000-0000-0000-0000000000a1', '3a000000-0000-0000-0000-000000000003',
   'Admin', 'admin', true),
  ('3b000000-0000-0000-0000-0000000000b1', '3b000000-0000-0000-0000-000000000004',
   'Forasteiro', 'admin', true),
  ('3a000000-0000-0000-0000-0000000000a1', '3a000000-0000-0000-0000-000000000005',
   'Desativado', 'member', false);

-- O GESTOR: escopo multi-org por fora de `team_members`. É a razão de a função
-- usar `get_my_admin_organization_ids()` e não `role = 'admin'` inline.
INSERT INTO public.gestores (id, user_id, is_active) VALUES
  ('3c000000-0000-0000-0000-0000000000c1', '3c000000-0000-0000-0000-000000000006', true);
INSERT INTO public.gestor_organizations (gestor_id, organization_id) VALUES
  ('3c000000-0000-0000-0000-0000000000c1', '3a000000-0000-0000-0000-0000000000a1');

SET LOCAL session_replication_role = origin;

-- As chamadas. Todas ATENDIDAS e ENCERRADAS: só chamada com conversa gera
-- gravação, e só chamada encerrada é projetada.
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status, authorized_at, ringing_at, connected_at, ended_at, end_reason)
VALUES
  -- 1: do VENDEDOR (org A)
  ('d3000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-0000000000a1',
   'sess-player-a', 'PLAYER0000000000000000000000001', '3a000000-0000-0000-0000-0000000000e1',
   '3a000000-0000-0000-0000-000000000001', '5548991005291', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '6 minutes', 'user_ended'),
  -- 2: do COLEGA (org A)
  ('d3000000-0000-0000-0000-000000000002', '3a000000-0000-0000-0000-0000000000a1',
   'sess-player-a', 'PLAYER0000000000000000000000002', '3a000000-0000-0000-0000-0000000000e1',
   '3a000000-0000-0000-0000-000000000002', '5548991005291', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '7 minutes', 'user_ended'),
  -- 4: da ORG B — o alvo cross-tenant
  ('d3000000-0000-0000-0000-000000000004', '3b000000-0000-0000-0000-0000000000b1',
   'sess-player-b', 'PLAYER0000000000000000000000004', '3b000000-0000-0000-0000-0000000000e2',
   '3b000000-0000-0000-0000-000000000004', '5548991005292', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '5 minutes', 'user_ended'),
  -- 5: do membro DESATIVADO
  ('d3000000-0000-0000-0000-000000000005', '3a000000-0000-0000-0000-0000000000a1',
   'sess-player-a', 'PLAYER0000000000000000000000005', '3a000000-0000-0000-0000-0000000000e1',
   '3a000000-0000-0000-0000-000000000005', '5548991005291', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '4 minutes', 'user_ended'),
  -- 6: a que vai FALHAR e depois se recuperar (org A, do vendedor)
  ('d3000000-0000-0000-0000-000000000006', '3a000000-0000-0000-0000-0000000000a1',
   'sess-player-a', 'PLAYER0000000000000000000000006', '3a000000-0000-0000-0000-0000000000e1',
   '3a000000-0000-0000-0000-000000000001', '5548991005291', 'outbound', 'ended',
   now() - interval '10 minutes', now() - interval '10 minutes',
   now() - interval '9 minutes', now() - interval '3 minutes', 'user_ended');

-- As três gravações que existem no bucket. Pelo caminho de produção:
-- `fn_voip_recording_stored` recompõe o caminho a partir da linha e recusa se
-- divergir, então passar por ela é o que garante que os nomes abaixo são
-- exatamente os que o CRM escreveria.
SELECT is(
  public.fn_voip_recording_stored(
    'd3000000-0000-0000-0000-000000000001',
    '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus',
    720000),
  'stored',
  'a gravação do vendedor é guardada');

SELECT is(
  public.fn_voip_recording_stored(
    'd3000000-0000-0000-0000-000000000002',
    '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000002.opus',
    500000),
  'stored',
  'a do colega também');

SELECT is(
  public.fn_voip_recording_stored(
    'd3000000-0000-0000-0000-000000000004',
    '3b000000-0000-0000-0000-0000000000b1/d3000000-0000-0000-0000-000000000004.opus',
    400000),
  'stored',
  'e a da org B');

SELECT is(
  public.fn_voip_recording_stored(
    'd3000000-0000-0000-0000-000000000005',
    '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000005.opus',
    300000),
  'stored',
  'e a do membro que depois foi desativado');

-- Os objetos, como o storage os teria.
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('call-recordings',
   '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb),
  ('call-recordings',
   '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000002.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb),
  ('call-recordings',
   '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000005.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb),
  ('call-recordings',
   '3b000000-0000-0000-0000-0000000000b1/d3000000-0000-0000-0000-000000000004.opus',
   NULL, '{"mimetype":"audio/ogg"}'::jsonb);

-- ===========================================================================
-- (1) QUEM OUVE — pelo caminho do PLAYER, um SELECT de verdade
-- ===========================================================================
-- Tudo daqui para baixo roda como `authenticated`. Como `postgres` a RLS é
-- bypassada e TODA asserção passaria — falso verde perfeito.
--
-- O player não lê `fn_voip_can_hear_recording`; ele pede uma URL assinada, e o
-- storage-api faz um SELECT em `storage.objects` com o JWT do usuário. É esse
-- SELECT que está abaixo. Uma regra correta pendurada em policy nenhuma
-- passaria em qualquer teste que chamasse a função direto.
SET LOCAL ROLE authenticated;

-- ── O VENDEDOR ──
SET LOCAL request.jwt.claims = '{"sub":"3a000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings'
      AND name = '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus'),
  1,
  'o vendedor ALCANÇA a própria gravação — é o que a torna autocorreção, não vigilância');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings'
      AND name = '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000002.opus'),
  0,
  'e NÃO alcança a do colega: conversa com cliente não é material de time');

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  1,
  'o acervo inteiro do vendedor é UMA gravação — a dele');

-- ── O COLEGA, na direção contrária ──
-- A simetria importa: uma policy que só filtrasse num sentido passaria na
-- asserção de cima e entregaria o acervo neste.
SET LOCAL request.jwt.claims = '{"sub":"3a000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings'
      AND name = '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus'),
  0,
  'colega não ouve colega — nos dois sentidos');

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  1,
  'o colega também vê só a dele');

-- ── O ADMIN ──
SET LOCAL request.jwt.claims = '{"sub":"3a000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  3,
  'o admin ouve TODAS as da organização dele — as três da org A (história 8)');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings' AND name LIKE '3b000000%'),
  0,
  'e nenhuma da org B: ser admin não é ser admin de todo mundo');

-- ── O GESTOR (ADR-0021) — o caso que a S2 não cobre ──
-- Ele NÃO tem linha em `team_members` da org A. Se a regra fosse
-- `role = 'admin'` inline, ele veria zero — e passaria despercebido em toda a
-- suíte da S2.
SET LOCAL request.jwt.claims = '{"sub":"3c000000-0000-0000-0000-000000000006","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  3,
  'o GESTOR ouve todas as da organização que ele gere, sem ser team_member dela');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings'
      AND name = '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus'),
  1,
  'inclusive a de um vendedor específico');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings' AND name LIKE '3b000000%'),
  0,
  'mas só nas organizações que estão em gestor_organizations');

-- ── O FORASTEIRO, COM O CAMINHO EM MÃOS (história 16) ──
SET LOCAL request.jwt.claims = '{"sub":"3b000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings'
      AND name = '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus'),
  0,
  'de fora da organização ninguém alcança, NEM COM O CAMINHO DO ARQUIVO EM MÃOS');

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  1,
  'o forasteiro enxerga só a da própria organização');

-- O CAMINHO NÃO É AUTORIDADE. Segundo vetor: pendurar a chamada alheia debaixo
-- da PRÓPRIA pasta. A org que vale é a da LINHA, não a do nome do objeto.
SELECT ok(
  NOT public.fn_voip_can_hear_recording(
    '3b000000-0000-0000-0000-0000000000b1/d3000000-0000-0000-0000-000000000001.opus'),
  'renomear o objeto para debaixo da própria pasta não concede nada');

-- ── O MEMBRO DESATIVADO ──
-- O furo do #1209 nesta roupa: `get_my_organization_ids` filtra `is_active`, e
-- é isso que fecha. Quem saiu da organização para de ouvir, inclusive o que
-- gravou.
SET LOCAL request.jwt.claims = '{"sub":"3a000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'call-recordings'
      AND name = '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000005.opus'),
  0,
  'membro DESATIVADO não ouve nem a própria gravação');

SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'call-recordings'),
  0,
  'e não ouve nada mais');

-- ── NINGUÉM LOGADO ESCREVE ──
-- Se pudesse, escolheria a organização do caminho — e a fronteira de tenant
-- viraria escolha do atacante, que é o vetor que `path_mismatch` fecha do outro
-- lado.
SET LOCAL request.jwt.claims = '{"sub":"3a000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  $ins$INSERT INTO storage.objects (bucket_id, name, owner, metadata)
       VALUES ('call-recordings',
               '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000009.opus',
               NULL, '{}'::jsonb)$ins$,
  '42501',
  NULL,
  'nem o admin planta objeto no bucket — só o service_role escreve');

RESET ROLE;

-- ===========================================================================
-- (2) O QUE A TELA LÊ — os quatro casos, em call_logs
-- ===========================================================================
-- O player lê `call_logs`, não `voip_calls`. Um estado que não atravessa a
-- projeção não existe para quem olha a tela.

-- AUSÊNCIA. É o estado de 100% das linhas em produção hoje, e é o que não pode
-- ser confundido com falha.
SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  NULL,
  'chamada sem evento de gravação chega à tela como AUSÊNCIA');

SELECT is(
  (SELECT recording_failure_reason FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  NULL,
  'e ausência não carrega causa nenhuma');

-- PROCESSANDO. O estado que responde "espere" em vez de "desista".
-- `fetch` é a INSTRUÇÃO de volta ("vá buscar o arquivo"), não o estado. O
-- estado é o que a asserção seguinte lê em `call_logs`, que é de onde a tela lê.
SELECT is(
  (SELECT public.fn_voip_recording_announced(
     'd3000000-0000-0000-0000-000000000006', 700000, 175000)),
  'fetch',
  'o anúncio manda o CRM buscar o arquivo');

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  'processing',
  'e PROCESSANDO atravessa até call_logs — sem isso o gestor acha que se perdeu');

-- FALHOU, COM CAUSA. Esta é a coluna que a S3 acrescenta: sem ela a tela diz
-- "falhou" e nada mais, e o gestor não sabe se espera outra tentativa.
SELECT is(
  public.fn_voip_recording_failed('d3000000-0000-0000-0000-000000000006', 'vps_timeout'),
  'failed',
  'a falha é aplicada');

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  'failed',
  'FALHOU atravessa até call_logs — e não vira ausência (história 20)');

SELECT is(
  (SELECT recording_failure_reason FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  'vps_timeout',
  'E A CAUSA JUNTO: é o que separa "falhou" de uma parede muda');

-- Segunda falha com causa DIFERENTE. O estado não muda (`failed` → `failed`),
-- então só o `WHEN` do gatilho olhando a causa faz a nova chegar à tela. Sem
-- essa linha, a tela mostraria para sempre o motivo da primeira tentativa.
SELECT is(
  public.fn_voip_recording_failed('d3000000-0000-0000-0000-000000000006', 'storage_upload_failed'),
  'failed',
  'uma segunda falha, com causa diferente');

SELECT is(
  (SELECT recording_failure_reason FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  'storage_upload_failed',
  'a causa NOVA chega à tela — o gatilho acorda mesmo quando só ela muda');

-- A RECUPERAÇÃO. `failed` → `ready` é caminho real (as funções de estado limpam
-- a causa de propósito). A causa NÃO pode sobreviver: a tela diria "pronta" e
-- "falhou por tempo esgotado" na mesma linha.
SELECT is(
  public.fn_voip_recording_stored(
    'd3000000-0000-0000-0000-000000000006',
    '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000006.opus',
    650000),
  'stored',
  'a gravação se recupera e é guardada');

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  'ready',
  'PRONTA atravessa');

SELECT is(
  (SELECT recording_failure_reason FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  NULL,
  'e a causa da falha antiga SOME: ela é atributo do estado, não valor solto');

SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000006'),
  '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000006.opus',
  'e o endereço está lá para o player assinar');

-- E a projeção continua NÃO apagando o que já sabia. Uma correção de
-- `end_reason` chegando depois não pode zerar nem o endereço nem a causa.
UPDATE public.voip_calls SET end_reason = 'declined'
 WHERE id = 'd3000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'd3000000-0000-0000-0000-000000000001'),
  '3a000000-0000-0000-0000-0000000000a1/d3000000-0000-0000-0000-000000000001.opus',
  'reprojeção por motivo alheio à gravação não apaga o endereço do áudio');

SELECT * FROM finish();
ROLLBACK;

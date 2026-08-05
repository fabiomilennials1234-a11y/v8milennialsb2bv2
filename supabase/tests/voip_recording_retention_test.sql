BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos. Sem esta linha, `SELECT plan(...)` estoura com "function plan(integer)
-- does not exist".
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova o expurgo de 90 dias e o reenfileiramento da busca que falhou
-- (20270804000001_voip_recording_retention.sql, Gravação S4 #1360).
--
-- A COSTURA É A REUSADA: função mais cron, na forma do
-- `voip_sweep_stuck_calls_test.sql`. A diferença de desenho é imposta pelo
-- armazenamento, não escolhida: `storage.objects` tem o gatilho
-- `protect_objects_delete`, que LEVANTA 42501 em qualquer DELETE vindo do SQL
-- ("Use the Storage API instead"). O expurgo, portanto, não pode ser um cron de
-- SQL puro — é cron → edge function → Storage API → confirmação de volta no
-- banco. Este arquivo prova a metade de banco: quem está vencido, e sob que
-- condição o CRM aceita esquecer um endereço.
--
-- O MUTANTE QUE MAIS IMPORTA — "trocar o apagar-de-verdade por
-- apagar-só-a-referência" — morre na seção (3): `fn_voip_recording_purged`
-- RECUSA enquanto o objeto ainda estiver em `storage.objects`. Quem pular a
-- Storage API não consegue marcar nada como expurgado, e "90 dias" não vira
-- intenção. Tire o `IF EXISTS ... storage.objects` da função e as asserções
-- 7, 8 e 9 ficam vermelhas.
--
-- O SEGUNDO MUTANTE, medido na S2: conceder EXECUTE a `anon` deixou o
-- `rls_invariants` VERDE — a rede que parece geral não cobre grant de função.
-- Por isso a seção (1) confere `has_function_privilege` NOME POR NOME. Neste
-- projeto `REVOKE ... FROM PUBLIC` não fecha função nova: o
-- `ALTER DEFAULT PRIVILEGES` do Supabase concede EXECUTE a anon e authenticated
-- automaticamente, e só o REVOKE nominal alcança.
SELECT plan(42);

-- ===========================================================================
-- (0) O QUE SE MEDE TEM QUE SER O QUE RODA
-- ===========================================================================
-- Se estes dois caírem, tudo o que segue está testando uma máquina que
-- produção não liga.
SELECT ok(
  EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'torquecalls-recording-maintenance'
       AND active = true
       AND schedule = '3-59/5 * * * *'
  ),
  'torquecalls-recording-maintenance está agendado, ativo, de 5 em 5 minutos'
);

SELECT is(
  (SELECT btrim(command) FROM cron.job WHERE jobname = 'torquecalls-recording-maintenance'),
  'SELECT public.invoke_torquecalls_recording_maintenance()',
  'o cron chama o invocador da edge function — o expurgo NÃO cabe em SQL puro '
  '(storage.protect_delete barra DELETE em storage.objects)'
);

-- ===========================================================================
-- (1) GRANT DE FUNÇÃO — A ASSERÇÃO ESPECÍFICA
-- ===========================================================================
-- `rls_invariants` não cobre isto. A prova é nominal, e a mensagem de falha
-- NOMEIA a função que vazou — um "0 leaks" mudo mandaria o próximo procurar.
SELECT is(
  (SELECT string_agg(f, ', ' ORDER BY f) FROM (
     SELECT f FROM unnest(ARRAY[
       'public.fn_voip_recording_purge_candidates(integer)',
       'public.fn_voip_recording_purged(uuid)',
       'public.fn_voip_recording_fetch_failed(uuid, text)',
       'public.fn_voip_recording_retry_claim(integer)',
       'public.fn_voip_recording_retry_delay(integer)',
       'public.invoke_torquecalls_recording_maintenance()'
     ]) AS f
      WHERE has_function_privilege('anon', f, 'EXECUTE')
   ) leaked),
  NULL,
  'anon NÃO executa nenhuma função nova desta fatia'
);

SELECT is(
  (SELECT string_agg(f, ', ' ORDER BY f) FROM (
     SELECT f FROM unnest(ARRAY[
       'public.fn_voip_recording_purge_candidates(integer)',
       'public.fn_voip_recording_purged(uuid)',
       'public.fn_voip_recording_fetch_failed(uuid, text)',
       'public.fn_voip_recording_retry_claim(integer)',
       'public.fn_voip_recording_retry_delay(integer)',
       'public.invoke_torquecalls_recording_maintenance()'
     ]) AS f
      WHERE has_function_privilege('authenticated', f, 'EXECUTE')
   ) leaked),
  NULL,
  'authenticated NÃO executa nenhuma função nova desta fatia'
);

-- A fiação positiva: sem ela, uma migration que revoga de todo mundo passaria
-- nas duas acima e deixaria a edge function sem poder chamar nada.
SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY[
     'public.fn_voip_recording_purge_candidates(integer)',
     'public.fn_voip_recording_purged(uuid)',
     'public.fn_voip_recording_fetch_failed(uuid, text)',
     'public.fn_voip_recording_retry_claim(integer)'
   ]) AS f
    WHERE has_function_privilege('service_role', f, 'EXECUTE')),
  4,
  'service_role executa as quatro — é ele quem a edge function usa'
);

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- `replica` desliga os triggers de negócio das tabelas de apoio
-- (trg_enforce_whatsapp_instance_limit chama assert_org_access e levanta
-- access_denied rodando como postgres sem JWT; `leads` tem 20 triggers que não
-- interessam aqui). CRÍTICO: volta para `origin` ANTES de escrever em
-- voip_calls — é o gatilho da projeção que sustenta a asserção "a linha de
-- call_logs sobrevive ao expurgo", e em `replica` ele não dispara.
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('4a000000-0000-0000-0000-0000000000a1', 'Org Expurgo', 'org-expurgo');

INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('4a000000-0000-0000-0000-0000000000aa', '4a000000-0000-0000-0000-0000000000a1',
        'inst-expurgo', true, NULL);

INSERT INTO public.voip_sessions
  (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('4a000000-0000-0000-0000-0000000000a1', '4a000000-0000-0000-0000-0000000000aa',
        'sess-expurgo', 'TorqueCalls Expurgo', 'open');

INSERT INTO public.leads (id, organization_id, name, phone)
VALUES ('4a000000-0000-0000-0000-0000000000e1', '4a000000-0000-0000-0000-0000000000a1',
        'Lead Expurgo', '5548991005289');

INSERT INTO auth.users (id, email)
VALUES ('4a000000-0000-0000-0000-000000000001', 'vendedor@expurgo.test');

INSERT INTO public.team_members (organization_id, user_id, name, role, is_active)
VALUES ('4a000000-0000-0000-0000-0000000000a1', '4a000000-0000-0000-0000-000000000001',
        'Vendedor Expurgo', 'member', true);

SET LOCAL session_replication_role = origin;

-- As chamadas. Todas ATENDIDAS e ENCERRADAS — só conversa gera gravação, e só
-- chamada encerrada é projetada em call_logs.
--
-- A fronteira dos 90 dias é exercida pelos dois lados com um dia de folga de
-- cada lado (91 e 89). Escolher 90 e 90,1 provaria a mesma coisa e quebraria
-- por relógio no dia em que a suíte rodasse na virada.
--
-- `updated_at` É SEMEADO À MÃO, e não é detalhe de fixture. Com o DEFAULT
-- `now()`, TODA linha nasce recém-tocada — e uma fila que caísse de volta em
-- `updated_at` como âncora de tempo pareceria correta, porque nenhuma linha do
-- fixture seria velha o bastante para ser pega pelo caminho errado. Foi medido:
-- o mutante que troca `recording_last_attempt_at` por
-- `COALESCE(recording_last_attempt_at, updated_at)` SOBREVIVEU a esta suíte até
-- estes carimbos existirem. Fixture que passa pelo motivo errado é a forma mais
-- cara de teste verde. (Vale a regra do projeto: coluna de estado não é trilha —
-- `updated_at` descreve o agora, e a fila tem que ler a trilha da busca.)
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status, authorized_at, ringing_at, connected_at, ended_at, end_reason,
   recording_status, recording_path, recording_bytes, recording_duration_ms,
   recording_notice_regime, recording_stored_at,
   recording_refetch_count, recording_last_attempt_at, recording_failure_reason,
   created_at, updated_at)
VALUES
  -- VENCIDA: gravação de ligação de 91 dias atrás. O alvo.
  ('c4000000-0000-0000-0000-000000000091', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO00000000000000000000091A', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '91 days', now() - interval '91 days',
   now() - interval '91 days' + interval '20 seconds',
   now() - interval '91 days' + interval '3 minutes 20 seconds', 'user_ended',
   'ready', '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000091.opus',
   735232, 180000, 'no_notice', now() - interval '91 days' + interval '4 minutes',
   0, NULL, NULL,
   now() - interval '91 days', now() - interval '91 days'),

  -- NÃO VENCIDA: 89 dias. A asserção que impede o expurgo de virar
  -- destruidor de acervo vivo — o defeito pior que o que ele conserta.
  ('c4000000-0000-0000-0000-000000000089', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO00000000000000000000089A', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '89 days', now() - interval '89 days',
   now() - interval '89 days' + interval '20 seconds',
   now() - interval '89 days' + interval '2 minutes', 'user_ended',
   'ready', '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000089.opus',
   400000, 100000, 'no_notice', now() - interval '89 days' + interval '3 minutes',
   0, NULL, NULL,
   now() - interval '89 days', now() - interval '89 days'),

  -- Anunciada e nunca guardada, de 200 dias atrás. `processing` não tem áudio
  -- para apagar, e marcá-la `purged` diria que houve o que não houve.
  ('c4000000-0000-0000-0000-0000000000fc', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO0000000000000000000000FC', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '200 days', now() - interval '200 days',
   now() - interval '200 days' + interval '20 seconds',
   now() - interval '200 days' + interval '1 minute', 'user_ended',
   'processing', NULL, NULL, NULL, 'no_notice', NULL,
   0, NULL, NULL,
   now() - interval '200 days', now() - interval '200 days'),

  -- BUSCA FALHADA, na hora: falhou há 10 minutos, nenhum reenfileiramento
  -- ainda, ligação de uma hora atrás. A elegível.
  ('c4000000-0000-0000-0000-0000000000d1', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO000000000000000000000R01', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '65 minutes', now() - interval '65 minutes',
   now() - interval '65 minutes' + interval '20 seconds', now() - interval '61 minutes',
   'user_ended',
   'failed', NULL, NULL, NULL, 'no_notice', NULL,
   0, now() - interval '10 minutes', 'vps_timeout',
   now() - interval '65 minutes', now() - interval '10 minutes'),

  -- BUSCA FALHADA, CEDO DEMAIS: falhou há 1 minuto. O espaçamento de 5 minutos
  -- é o que impede a fila de virar martelo em cima de uma VPS caída.
  ('c4000000-0000-0000-0000-0000000000d2', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO000000000000000000000R02', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '65 minutes', now() - interval '65 minutes',
   now() - interval '65 minutes' + interval '20 seconds', now() - interval '61 minutes',
   'user_ended',
   'failed', NULL, NULL, NULL, 'no_notice', NULL,
   0, now() - interval '1 minute', 'vps_unreachable',
   now() - interval '65 minutes', now() - interval '1 minute'),

  -- BUSCA FALHADA NO TETO: quatro reenfileiramentos já gastos. Não há quinta.
  ('c4000000-0000-0000-0000-0000000000d3', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO000000000000000000000R03', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '5 hours', now() - interval '5 hours',
   now() - interval '5 hours' + interval '20 seconds', now() - interval '4 hours 56 minutes',
   'user_ended',
   'failed', NULL, NULL, NULL, 'no_notice', NULL,
   4, now() - interval '2 hours', 'vps_timeout',
   now() - interval '5 hours', now() - interval '2 hours'),

  -- FALHA ANUNCIADA PELA VPS: não haverá arquivo, e por isso não há o que
  -- buscar. `recording_last_attempt_at` NULO é o que a separa da busca falhada.
  ('c4000000-0000-0000-0000-0000000000d4', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO000000000000000000000R04', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '65 minutes', now() - interval '65 minutes',
   now() - interval '65 minutes' + interval '20 seconds', now() - interval '61 minutes',
   'user_ended',
   'failed', NULL, NULL, NULL, 'no_notice', NULL,
   -- `updated_at` de 61 minutos atrás, e é DE PROPÓSITO: é o que faz esta linha
   -- ser pega por uma fila que ancorasse em `updated_at` em vez de na trilha da
   -- busca. Sem este carimbo, o mutante correspondente sobrevive.
   0, NULL, 'encoder_panic',
   now() - interval '65 minutes', now() - interval '61 minutes'),

  -- BUSCA FALHADA MAS VELHA: ligação de 30 horas atrás. A barreira de relógio,
  -- independente do contador — ela é o que fecha o laço de um worker que morre
  -- antes de relatar.
  ('c4000000-0000-0000-0000-0000000000d5', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO000000000000000000000R05', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '30 hours', now() - interval '30 hours',
   now() - interval '30 hours' + interval '20 seconds', now() - interval '29 hours',
   'user_ended',
   'failed', NULL, NULL, NULL, 'no_notice', NULL,
   0, now() - interval '20 hours', 'vps_unreachable',
   now() - interval '30 hours', now() - interval '20 hours'),

  -- NUNCA GRAVOU: ligação atendida, gravação desligada na VPS (ou não atendida
  -- num mundo em que houvesse). `recording_status` NULO é a AUSÊNCIA, e existe
  -- neste fixture para que "expurgada" tenha com o que ser contrastada. Sem
  -- esta linha, a asserção de estado próprio compararia `purged` só com
  -- `failed`.
  ('c4000000-0000-0000-0000-0000000000d6', '4a000000-0000-0000-0000-0000000000a1',
   'sess-expurgo', 'EXPURGO000000000000000000000R06', '4a000000-0000-0000-0000-0000000000e1',
   '4a000000-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ended',
   now() - interval '120 days', now() - interval '120 days',
   now() - interval '120 days' + interval '20 seconds', now() - interval '120 days'
     + interval '90 seconds',
   'user_ended',
   NULL, NULL, NULL, NULL, NULL, NULL,
   0, NULL, NULL,
   now() - interval '120 days', now() - interval '120 days');

-- Os objetos no armazenamento. `storage.objects` é o índice do bucket: a
-- Storage API apaga a linha E os bytes; o SQL não apaga nem a linha.
INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES
  ('call-recordings',
   '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000091.opus',
   NULL, '{"mimetype":"audio/ogg","size":735232}'::jsonb),
  ('call-recordings',
   '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000089.opus',
   NULL, '{"mimetype":"audio/ogg","size":400000}'::jsonb);

-- ===========================================================================
-- (2) QUEM ESTÁ VENCIDO — E, SOBRETUDO, QUEM NÃO ESTÁ
-- ===========================================================================
-- `results_eq` e não `ok(EXISTS ...)`: a pergunta não é "a de 91 dias aparece",
-- é "aparece ELA E MAIS NINGUÉM". Um predicado frouxo que arrastasse a de 89
-- dias passaria numa asserção de existência.
SELECT results_eq(
  $$SELECT call_id, object_path FROM public.fn_voip_recording_purge_candidates(100)$$,
  $$VALUES ('c4000000-0000-0000-0000-000000000091'::uuid,
            '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000091.opus'::text)$$,
  'vencida é a de 91 dias, e SÓ ela — a de 89 fica, e a `processing` de 200 '
  'dias não tem áudio para vencer'
);

-- ===========================================================================
-- (3) O MUTANTE: APAGAR-SÓ-A-REFERÊNCIA É RECUSADO
-- ===========================================================================
-- Este é o coração da fatia. Enquanto o objeto estiver em `storage.objects`, o
-- banco NÃO aceita esquecer o endereço. Quem trocar o apagar-de-verdade por
-- apagar-só-a-referência — pulando a Storage API e vindo direto confirmar —
-- não consegue mover nada, e "90 dias" continua sendo fato.
SELECT is(
  public.fn_voip_recording_purged('c4000000-0000-0000-0000-000000000091'),
  'object_still_present',
  'com o objeto AINDA no armazenamento, o expurgo é RECUSADO'
);

SELECT results_eq(
  $$SELECT recording_status, recording_path IS NOT NULL, recording_purged_at IS NULL
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-000000000091'$$,
  $$VALUES ('ready'::text, true, true)$$,
  'e NADA foi esquecido: continua `ready`, com endereço e sem carimbo de expurgo'
);

SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'c4000000-0000-0000-0000-000000000091'),
  '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000091.opus',
  'o endereço em call_logs também continua lá — a recusa é total, não parcial'
);

-- ===========================================================================
-- (4) O APAGAR DE VERDADE
-- ===========================================================================
-- `storage.allow_delete_query` é a válvula que a própria Supabase usa para
-- deixar a Storage API passar pelo gatilho `protect_objects_delete`. Aqui ela
-- simula o efeito da chamada `storage.from(...).remove([...])` — a linha some,
-- e é a ausência dela que a função de confirmação vai exigir. O código de
-- produção NÃO usa esta válvula: ele não pode, e é esse o ponto.
DO $storage_api$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects
   WHERE bucket_id = 'call-recordings'
     AND name = '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000091.opus';
  -- Fecha a válvula na mesma transação: o resto do arquivo tem que voltar a
  -- viver sob a regra de produção, em que SQL não apaga objeto.
  PERFORM set_config('storage.allow_delete_query', 'false', true);
END
$storage_api$;

SELECT is(
  public.fn_voip_recording_purged('c4000000-0000-0000-0000-000000000091'),
  'purged',
  'com o objeto FORA do armazenamento, o expurgo é aceito'
);

-- A asserção literal do enunciado: o objeto some do ARMAZENAMENTO, não só a
-- referência.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'call-recordings'
       AND name = '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000091.opus'
  ),
  'o OBJETO sumiu do armazenamento — não só a referência'
);

SELECT results_eq(
  $$SELECT recording_status, recording_path, recording_purged_at IS NOT NULL
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-000000000091'$$,
  $$VALUES ('purged'::text, NULL::text, true)$$,
  'a autoridade perdeu o endereço e ganhou o carimbo — `purged` não é NULO, '
  'porque "expurgada" e "nunca gravada" são coisas diferentes'
);

-- Bytes e duração SOBREVIVEM: são fatos sobre o que existiu, e a história 18 do
-- PRD (medir o custo em espaço) fica sem fonte se o expurgo os levar junto.
SELECT results_eq(
  $$SELECT recording_bytes, recording_duration_ms
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-000000000091'$$,
  $$VALUES (735232::bigint, 180000::integer)$$,
  'tamanho e duração sobrevivem ao expurgo — o que morre é o endereço e o áudio'
);

-- ===========================================================================
-- (5) A LINHA DE call_logs SOBREVIVE
-- ===========================================================================
-- Perde o endereço, mantém desfecho e duração. Sem isto, expurgar gravação
-- apagaria o registro de que a ligação aconteceu — e o recibo é a única coisa
-- que a S13 pôs ali.
SELECT is(
  (SELECT recording_url FROM public.call_logs
    WHERE voip_call_id = 'c4000000-0000-0000-0000-000000000091'),
  NULL,
  'call_logs perdeu o endereço do áudio'
);

SELECT is(
  (SELECT recording_status FROM public.call_logs
    WHERE voip_call_id = 'c4000000-0000-0000-0000-000000000091'),
  'purged',
  'e diz `purged` — o gestor sabe que existiu e que chegou tarde, em vez de '
  'achar que a ligação nunca foi gravada'
);

SELECT results_eq(
  $$SELECT outcome, duration_seconds, direction, phone_number IS NOT NULL
      FROM public.call_logs WHERE voip_call_id = 'c4000000-0000-0000-0000-000000000091'$$,
  $$VALUES ('connected'::text, 180::integer, 'outbound'::text, true)$$,
  'a linha SOBREVIVE ao expurgo do áudio: desfecho, duração e destino intactos'
);

-- ---------------------------------------------------------------------------
-- O QUARTO ESTADO, CONTRASTADO COM OS OUTROS TRÊS — E POR QUE ISSO É DA TELA
-- ---------------------------------------------------------------------------
-- A S3 (#1359) mediu: o storage do Supabase responde 4xx IGUAL para "sem
-- permissão para este objeto" e para "objeto não existe mais". Uma tela que
-- deduzisse o estado da ausência do arquivo diria "Só quem fez a ligação e a
-- gestão podem ouvir" sobre uma gravação que simplesmente venceu — mensagem
-- errada, que aponta para um problema de permissão onde houve expurgo normal.
--
-- Por isso o estado é DECLARADO no banco, e não deduzido do armazenamento. É a
-- mesma exigência de estados não-colapsados que a S2 atendeu, agora com um
-- quarto: quem lê `call_logs` distingue as quatro situações sem tocar no bucket.
--
--   NULO ......... a ligação nunca foi gravada
--   ready ........ há áudio para ouvir
--   failed ....... quebrou, e a causa está registrada
--   purged ....... existiu, foi ouvível, e os 90 dias venceram
SELECT results_eq(
  $$SELECT voip_call_id, recording_status, recording_url IS NULL
      FROM public.call_logs
     WHERE voip_call_id IN ('c4000000-0000-0000-0000-000000000091',
                            'c4000000-0000-0000-0000-000000000089',
                            'c4000000-0000-0000-0000-0000000000d6',
                            'c4000000-0000-0000-0000-0000000000d5')
     ORDER BY voip_call_id$$,
  $$VALUES ('c4000000-0000-0000-0000-000000000089'::text, 'ready'::text,  false),
           ('c4000000-0000-0000-0000-000000000091'::text, 'purged'::text, true),
           ('c4000000-0000-0000-0000-0000000000d5'::text, 'failed'::text, true),
           ('c4000000-0000-0000-0000-0000000000d6'::text, NULL::text,     true)$$,
  'expurgada tem ESTADO PRÓPRIO em call_logs: `purged` não se confunde com '
  'nunca-gravou (NULO) nem com falhou — a tela pode dizer "expirou em 90 dias" '
  'em vez de acusar falta de permissão'
);

-- ===========================================================================
-- (6) RODAR DUAS VEZES NÃO QUEBRA
-- ===========================================================================
SELECT is(
  public.fn_voip_recording_purged('c4000000-0000-0000-0000-000000000091'),
  'already_purged',
  'a segunda passada é inofensiva'
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_voip_recording_purge_candidates(100)),
  0,
  'e a lista de vencidas esvaziou — a varredura seguinte não acha nada'
);

-- ===========================================================================
-- (7) 89 DIAS CONTINUA INTEIRA
-- ===========================================================================
SELECT results_eq(
  $$SELECT recording_status, recording_path IS NOT NULL
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-000000000089'$$,
  $$VALUES ('ready'::text, true)$$,
  'a de 89 dias NÃO foi expurgada'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'call-recordings'
       AND name = '4a000000-0000-0000-0000-0000000000a1/c4000000-0000-0000-0000-000000000089.opus'
  ),
  'e o objeto dela continua no armazenamento'
);

-- ===========================================================================
-- (8) O EXPURGO SÓ TOCA O QUE ESTAVA GUARDADO
-- ===========================================================================
SELECT is(
  public.fn_voip_recording_purged('c4000000-0000-0000-0000-0000000000fc'),
  'not_stored',
  'gravação `processing` não é expurgável — não há áudio para apagar'
);

SELECT is(
  public.fn_voip_recording_purged('99999999-9999-4999-8999-999999999999'),
  'call_not_found',
  'chamada inexistente é recusada, não inventada'
);

-- ===========================================================================
-- (9) O ESPAÇAMENTO É POLÍTICA, E POLÍTICA SE LÊ
-- ===========================================================================
-- 5 → 15 → 45 → 135 minutos, e NULO no quarto. Exercer a escada diretamente
-- impede que ela vire folclore observável só por efeito colateral.
SELECT results_eq(
  $$SELECT n, public.fn_voip_recording_retry_delay(n)
      FROM generate_series(0, 4) AS n$$,
  $$VALUES (0, interval '5 minutes'), (1, interval '15 minutes'),
           (2, interval '45 minutes'), (3, interval '135 minutes'),
           (4, NULL::interval)$$,
  'a escada é 5/15/45/135 minutos e o quarto reenfileiramento não existe — '
  '~3h20 no total, dentro do dia que a história 22 do PRD promete'
);

-- ===========================================================================
-- (10) A FILA — QUEM É REIVINDICADO
-- ===========================================================================
-- De novo `results_eq`: a pergunta é "quem entra E quem não entra". As quatro
-- que ficam de fora ficam por quatro razões diferentes, e cada uma delas seria
-- um defeito distinto se caísse.
SELECT results_eq(
  $$SELECT call_id, refetch_count FROM public.fn_voip_recording_retry_claim(50)$$,
  $$VALUES ('c4000000-0000-0000-0000-0000000000d1'::uuid, 1)$$,
  'reivindica SÓ a que está na hora: fora ficam a recente demais (espaçamento), '
  'a do teto (4 gastos), a anunciada pela VPS (não há o que buscar) e a de '
  'ontem (barreira de 24 h)'
);

SELECT results_eq(
  $$SELECT recording_refetch_count, recording_status,
           recording_last_attempt_at > now() - interval '5 seconds'
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-0000000000d1'$$,
  $$VALUES (1, 'failed'::text, true)$$,
  'a ficha é gasta NA ENTRADA e o status continua `failed` — worker que morre '
  'não vira laço, e ninguém fica olhando "processando" para sempre'
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_voip_recording_retry_claim(50)),
  0,
  'a segunda reivindicação imediata não devolve nada — o carimbo é arrendamento'
);

-- ===========================================================================
-- (11) A FALHA REENFILEIRA, E DEPOIS DESISTE
-- ===========================================================================
SELECT is(
  public.fn_voip_recording_fetch_failed('c4000000-0000-0000-0000-0000000000d1',
                                        'vps_timeout'),
  'retry_scheduled',
  'a busca que falhou com 1 ficha gasta volta para a fila'
);

SELECT results_eq(
  $$SELECT recording_status, recording_failure_reason, recording_fetch_abandoned_at IS NULL
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-0000000000d1'$$,
  $$VALUES ('failed'::text, 'vps_timeout'::text, true)$$,
  'com a causa registrada e sem carimbo de desistência'
);

-- Gasta as fichas restantes e chega ao teto.
UPDATE public.voip_calls
   SET recording_refetch_count = 4
 WHERE id = 'c4000000-0000-0000-0000-0000000000d1';

SELECT is(
  public.fn_voip_recording_fetch_failed('c4000000-0000-0000-0000-0000000000d1',
                                        'vps_unreachable'),
  'abandoned',
  'no teto de 4 reenfileiramentos, desiste de vez'
);

SELECT results_eq(
  $$SELECT recording_failure_reason, recording_fetch_abandoned_at IS NOT NULL
      FROM public.voip_calls WHERE id = 'c4000000-0000-0000-0000-0000000000d1'$$,
  $$VALUES ('vps_unreachable'::text, true)$$,
  'desiste COM A CAUSA REGISTRADA — "desistiu" e "por quê" são duas perguntas '
  'e moram em duas colunas'
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_voip_recording_retry_claim(50)),
  0,
  'e a fila nunca mais a pega — retentativa infinita numa gravação cuja origem '
  'sumiu seria laço'
);

-- ===========================================================================
-- (12) MOTIVO TERMINAL DESISTE NA PRIMEIRA
-- ===========================================================================
-- `db_path_mismatch` é recomposto do mesmo jeito na próxima vez, com o mesmo
-- resultado. Gastar quatro buscas nele é ruído, não resiliência.
SELECT is(
  public.fn_voip_recording_fetch_failed('c4000000-0000-0000-0000-0000000000d2',
                                        'db_path_mismatch'),
  'abandoned',
  'motivo terminal desiste na primeira, sem gastar a escada'
);

SELECT is(
  (SELECT recording_fetch_abandoned_at IS NOT NULL FROM public.voip_calls
    WHERE id = 'c4000000-0000-0000-0000-0000000000d2'),
  true,
  'e carimba a desistência na hora'
);

-- ===========================================================================
-- (13) A FALHA ANUNCIADA PELA VPS NUNCA ENTRA NA FILA
-- ===========================================================================
-- `fn_voip_recording_failed` (S2) é a VPS dizendo "não vai haver arquivo".
-- Buscar de novo é bater numa porta que o dono avisou que não abre. A separação
-- entre as duas funções é o que impede isso — e é por isso que a da S2 fica
-- intocada.
SELECT is(
  (SELECT recording_last_attempt_at FROM public.voip_calls
    WHERE id = 'c4000000-0000-0000-0000-0000000000d4'),
  NULL,
  'falha ANUNCIADA pela VPS não carimba tentativa de busca'
);

SELECT is(
  public.fn_voip_recording_failed('c4000000-0000-0000-0000-0000000000d4',
                                  'encoder_panic'),
  'failed',
  'e a função da S2 segue funcionando como antes'
);

SELECT is(
  (SELECT recording_last_attempt_at FROM public.voip_calls
    WHERE id = 'c4000000-0000-0000-0000-0000000000d4'),
  NULL,
  'sem passar a entrar na fila por causa desta fatia'
);

-- ===========================================================================
-- (14) A BARREIRA DE RELÓGIO
-- ===========================================================================
-- Independente do contador. O contador é uma promessa de que alguém volta para
-- contar o que houve; o relógio não depende de ninguém voltar.
UPDATE public.voip_calls
   SET recording_last_attempt_at = now() - interval '10 minutes',
       recording_refetch_count   = 0
 WHERE id = 'c4000000-0000-0000-0000-0000000000d5';

SELECT is(
  (SELECT count(*)::int FROM public.fn_voip_recording_retry_claim(50)),
  0,
  'ligação de 30 horas atrás não é buscada mesmo com ficha e espaçamento em '
  'ordem — gravação de ontem que não chegou não vai chegar'
);

-- ===========================================================================
-- (15) NUNCA REBAIXA O QUE JÁ ESTÁ BOM
-- ===========================================================================
SELECT is(
  public.fn_voip_recording_fetch_failed('c4000000-0000-0000-0000-000000000089', 'vps_timeout'),
  'already_stored',
  'falha atrasada NÃO rebaixa uma gravação que está no bucket e toca'
);

SELECT is(
  (SELECT recording_status FROM public.voip_calls
    WHERE id = 'c4000000-0000-0000-0000-000000000089'),
  'ready',
  'a de 89 dias continua `ready` depois da falha atrasada'
);

SELECT is(
  public.fn_voip_recording_fetch_failed('c4000000-0000-0000-0000-000000000091', 'vps_timeout'),
  'already_purged',
  'e não RESSUSCITA uma expurgada — a fila iria buscar na VPS um arquivo que o '
  'CRM apagou de propósito'
);

SELECT is(
  (SELECT recording_status FROM public.voip_calls
    WHERE id = 'c4000000-0000-0000-0000-000000000091'),
  'purged',
  'a expurgada continua `purged`'
);

SELECT * FROM finish();
ROLLBACK;

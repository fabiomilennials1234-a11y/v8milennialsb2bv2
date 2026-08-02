BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos.
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova a projeção de `voip_calls` em `call_logs`
-- (20270801000000_voip_call_log_projection.sql).
--
-- O QUE ESTÁ EM JOGO
-- ------------------
-- `call_logs` é a tabela que o produto usa para o histórico de ligação do lead.
-- O S11 fez o CRM SABER o que acontece na chamada (`connected_at`, `ended_at`,
-- `end_reason` em `voip_calls`), mas nada disso chegava à tela: medido em
-- produção, `call_logs` tinha UMA linha, de registro manual, contra 13 chamadas
-- no ledger de voz.
--
-- SÃO TRÊS PORTAS QUE FECHAM CHAMADA, NÃO DUAS
-- --------------------------------------------
--   1. `torquecalls-signal` (edge fn, service_role) — UPDATE direto na tabela
--      no clique de desligar/recusar. É a porta que produziu 9 das 13 linhas
--      de produção (`user_ended`), e ela NÃO passa por RPC nenhuma.
--   2. `voip-sweep-stuck-calls` (pg_cron, postgres) — `no_terminal_event`.
--   3. `fn_voip_apply_vps_event` (webhook da VPS, SECURITY DEFINER).
--
-- Projetar dentro da RPC do webhook cobriria só a terceira. O gatilho em
-- `voip_calls` cobre as três, e este arquivo exercita as três PELO CAMINHO
-- REAL de cada uma — inclusive rodando a porta 1 como `service_role` e a porta
-- 2 pelo comando literal extraído de `cron.job`.
--
-- A ARMADILHA DA GRAFIA
-- ---------------------
-- A VPS emite `cancelled` (dois L); o CHECK de `call_logs.outcome` aceita
-- `canceled` (um L). Um mapeamento ingênuo é recusado pelo banco DENTRO da
-- transação do webhook, que é a transação que não se quer derrubar.
SELECT plan(44);

-- ===========================================================================
-- (0) A CHAVE NATURAL EXISTE NO SCHEMA
-- ===========================================================================
-- Sem o índice único não há `ON CONFLICT` para onde inferir, e a idempotência
-- vira convenção em vez de invariante. Parcial porque as linhas de registro
-- manual têm `voip_call_id` NULO e não podem colidir entre si.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'call_logs'
       AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%(voip_call_id)%'
       AND indexdef ILIKE '%voip_call_id IS NOT NULL%'
  ),
  'existe índice ÚNICO PARCIAL em call_logs(voip_call_id) — a chave natural da projeção'
);

-- Não escopado por organization_id de propósito: `voip_call_id` é o PK de
-- `voip_calls`, então a mesma chamada só pertence a uma org. Acrescentar a org
-- ENFRAQUECERIA a trava (permitiria a mesma chamada registrada em duas orgs) em
-- vez de proteger — seria um vetor cross-tenant disfarçado de multi-tenancy.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'call_logs'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(organization_id, voip_call_id)%'
  ),
  'a chave natural NÃO é escopada por org — escopar enfraqueceria a trava'
);

-- A projeção NÃO é uma API. `REVOKE ... FROM PUBLIC` sozinho não fecha nada
-- aqui: o Supabase tem ALTER DEFAULT PRIVILEGES concedendo EXECUTE a `anon`,
-- `authenticated` e `service_role` em toda função nova do schema `public`.
-- Sem os papéis nomeados, o INV-2 de rls_invariants.sql acusa a função como
-- "writing SECURITY DEFINER reachable by anon" — uma DEFINER que escreve em
-- call_logs, alcançável sem sessão.
SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon','authenticated','service_role','public']) r
    WHERE has_function_privilege(r, 'public.fn_voip_project_call_log(uuid)', 'EXECUTE')),
  0,
  'nenhum papel do PostgREST executa fn_voip_project_call_log — só o gatilho a alcança'
);

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- `replica` desliga os triggers de negócio das tabelas de apoio
-- (trg_enforce_whatsapp_instance_limit chama assert_org_access e levanta
-- access_denied rodando como postgres sem JWT; `leads` tem 20 triggers que não
-- interessam aqui). Mesmo tratamento de voip_sweep_stuck_calls_test.sql:41.
--
-- CRÍTICO: volta para `origin` ANTES de qualquer escrita em voip_calls — é o
-- gatilho desta migration que está sob teste, e em `replica` ele não dispara.
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('13000000-0000-0000-0000-000000000013', 'Org Projecao S13', 'org-projecao-s13');

INSERT INTO public.whatsapp_instances
  (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('13000000-0000-0000-0000-0000000000aa', '13000000-0000-0000-0000-000000000013',
        'inst-projecao-s13', true, NULL);

INSERT INTO public.voip_sessions
  (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('13000000-0000-0000-0000-000000000013', '13000000-0000-0000-0000-0000000000aa',
        'sess-s13-projecao', 'TorqueCalls', 'open');

INSERT INTO public.leads (id, organization_id, name, phone)
VALUES ('13000000-0000-0000-0000-0000000000e1', '13000000-0000-0000-0000-000000000013',
        'Lead Projecao S13', '5548991005289');

-- Um operador por cenário: `idx_voip_calls_one_live_per_operator` é UNIQUE
-- parcial sobre operator_user_id enquanto a linha está viva, então duas
-- chamadas vivas do mesmo operador não coexistem nem em teste.
DO $seed_ops$
DECLARE i int;
BEGIN
  FOR i IN 1..19 LOOP
    INSERT INTO auth.users (id, email)
    VALUES (('a0000013-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
            'op' || i || '@s13.test');
    INSERT INTO public.team_members (organization_id, user_id, name, role, is_active)
    VALUES ('13000000-0000-0000-0000-000000000013',
            ('a0000013-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
            'Operador ' || i, 'member', true);
  END LOOP;
END
$seed_ops$;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- As linhas vivas. Carimbos ancorados em now(), que dentro de UMA transação é
-- constante — por isso as asserções de duração podem ser exatas em vez de
-- faixas.
-- ---------------------------------------------------------------------------
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status, authorized_at, ringing_at, connected_at)
VALUES
  -- 01 atendida, será encerrada pelo operador (porta 1)
  ('c0000013-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000001', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'connected',
   now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '5 minutes'),
  -- 02..10 não atendidas, uma por motivo do vocabulário
  ('c0000013-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000002', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000002', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  ('c0000013-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000003', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000003', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  ('c0000013-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000004', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000004', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  ('c0000013-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000005', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000005', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  ('c0000013-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000006', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000006', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  ('c0000013-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000007', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000007', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  ('c0000013-0000-0000-0000-000000000008', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000008', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000008', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  -- 09 recusa do operador numa chamada de ENTRADA (porta 1, action=rejectCall)
  ('c0000013-0000-0000-0000-000000000009', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000009', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000009', '5548991005289', 'inbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  -- 10 operador desistiu antes de o outro lado atender
  ('c0000013-0000-0000-0000-000000000010', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000010', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000010', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  -- 11 chamada de ENTRADA sem operador — `operator_user_id` nasce NULO
  ('c0000013-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000011', '13000000-0000-0000-0000-0000000000e1',
   NULL, '5548991005289', 'inbound', 'connected',
   now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '4 minutes'),
  -- 12 chamada sem lead vinculado
  ('c0000013-0000-0000-0000-000000000012', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000012', NULL,
   'a0000013-0000-0000-0000-000000000012', '5548991005289', 'outbound', 'ringing',
   now() - interval '1 minute', now() - interval '1 minute', NULL),
  -- 13 alvo do VARREDOR: ringing velho, nunca atendeu
  ('c0000013-0000-0000-0000-000000000013', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000013', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000013', '5548991005289', 'outbound', 'ringing',
   now() - interval '30 minutes', now() - interval '30 minutes', NULL),
  -- 14 alvo do VARREDOR: connected há 3h — foi conversa de verdade
  ('c0000013-0000-0000-0000-000000000014', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000014', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000014', '5548991005289', 'outbound', 'connected',
   now() - interval '4 hours', now() - interval '4 hours', now() - interval '3 hours'),
  -- 15 porta do WEBHOOK: recente, o varredor não a alcança
  ('c0000013-0000-0000-0000-000000000015', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000015', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000015', '5548991005289', 'outbound', 'ringing',
   now(), now(), NULL),
  -- 16 VARREDOR e DEPOIS webhook com a causa verdadeira (sweeper_reason_corrected)
  ('c0000013-0000-0000-0000-000000000016', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000016', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000016', '5548991005289', 'outbound', 'ringing',
   now() - interval '30 minutes', now() - interval '30 minutes', NULL),
  -- 17 carimbo TARDIO de connected_at numa linha já encerrada (faixa tardia do S11)
  ('c0000013-0000-0000-0000-000000000017', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000017', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000017', '5548991005289', 'outbound', 'ringing',
   now(), now(), NULL),
  -- 18 reserva que venceu antes de a VPS aceitar — NÃO é ligação
  ('c0000013-0000-0000-0000-000000000018', '13000000-0000-0000-0000-000000000013',
   'sess-s13-projecao', 'S13CALL000000000000000000000018', '13000000-0000-0000-0000-0000000000e1',
   'a0000013-0000-0000-0000-000000000018', '5548991005289', 'outbound', 'authorized',
   now() - interval '1 minute', NULL, NULL);

-- ===========================================================================
-- (1) PORTA 1 — torquecalls-signal, UPDATE DIRETO COMO service_role
-- ===========================================================================
-- Rodar como `service_role` não é cerimônia: é a forma REAL desta porta. O
-- gatilho tem que disparar para um papel que não é dono da função nem tem
-- EXECUTE nela — se a projeção dependesse de privilégio de execução, a porta
-- mais usada em produção (9 das 13 linhas) seria justamente a que não projeta.
SET LOCAL ROLE service_role;

UPDATE public.voip_calls
   SET status = 'ended', end_reason = 'user_ended',
       ended_at = now() - interval '2 minutes', updated_at = now()
 WHERE id = 'c0000013-0000-0000-0000-000000000001';

SET LOCAL ROLE NONE;

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'),
  1,
  'PORTA 1 (service_role): o UPDATE direto de torquecalls-signal projeta a chamada'
);

SELECT results_eq(
  $$SELECT outcome, duration_seconds, voip_provider, notes, recording_url
      FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'$$,
  $$VALUES ('connected'::text, 180, 'torquecalls'::text, NULL::text, NULL::text)$$,
  'atendida + user_ended → connected, 180 s, provider torquecalls, sem conteúdo inventado'
);

-- A âncora da duração é `connected_at`, NÃO `authorized_at`. A linha 01 tocou
-- 5 minutos antes de atender: 10 min de vida, 5 min de conversa, 3 min medidos
-- até o fim. Se a projeção usasse authorized_at daria 480 s — tempo tocando
-- somado a tempo de conversa, que é o defeito que inflaria toda média de
-- duração do produto.
SELECT isnt(
  (SELECT duration_seconds FROM public.call_logs
    WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'),
  480,
  'duração NÃO conta o tempo tocando (não é ended_at - authorized_at)'
);

SELECT results_eq(
  $$SELECT started_at = (SELECT connected_at FROM public.voip_calls
                          WHERE id = 'c0000013-0000-0000-0000-000000000001'),
           ended_at   = (SELECT ended_at FROM public.voip_calls
                          WHERE id = 'c0000013-0000-0000-0000-000000000001')
      FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'$$,
  $$VALUES (true, true)$$,
  'atendida: started_at = connected_at e ended_at = ended_at da chamada'
);

SELECT results_eq(
  $$SELECT organization_id, lead_id, user_id, phone_number, direction
      FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'$$,
  $$VALUES ('13000000-0000-0000-0000-000000000013'::uuid,
            '13000000-0000-0000-0000-0000000000e1'::uuid,
            'a0000013-0000-0000-0000-000000000001'::uuid,
            '5548991005289'::text, 'outbound'::text)$$,
  'identidade copiada da própria voip_calls (user_id = operator_user_id)'
);

-- ===========================================================================
-- (2) O MAPEAMENTO DE `outcome`, MOTIVO A MOTIVO
-- ===========================================================================
-- A regra: `connected_at IS NOT NULL` decide "atendeu"; só quando NÃO houve
-- atendimento é que `end_reason` decide qual foi a recusa.
UPDATE public.voip_calls SET status='ended', end_reason='timeout',        ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000002';
UPDATE public.voip_calls SET status='ended', end_reason='declined',       ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000003';
UPDATE public.voip_calls SET status='ended', end_reason='cancelled',      ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000004';
UPDATE public.voip_calls SET status='ended', end_reason='busy',           ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000005';
UPDATE public.voip_calls SET status='ended', end_reason='do_not_disturb', ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000006';
UPDATE public.voip_calls SET status='ended', end_reason='failed',         ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000007';
UPDATE public.voip_calls SET status='ended', end_reason='unknown',        ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000008';
UPDATE public.voip_calls SET status='ended', end_reason='rejected',       ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000009';
UPDATE public.voip_calls SET status='ended', end_reason='user_ended',     ended_at=now() WHERE id='c0000013-0000-0000-0000-000000000010';

SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000002'),
          'no_answer', 'timeout → no_answer (ninguém atendeu)');

SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000003'),
          'rejected', 'declined → rejected (o outro lado recusou)');

-- A ARMADILHA. A VPS escreve `cancelled` (dois L) e o CHECK aceita `canceled`
-- (um L). Um mapeamento ingênuo não traduz, o INSERT é recusado e a exceção
-- derruba a transação DO WEBHOOK — em produção.
SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000004'),
          'canceled', 'cancelled (dois L, VPS) → canceled (um L, CHECK do banco)');

SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000005'),
          'busy', 'busy → busy');

-- `do_not_disturb` NÃO vira `rejected`: em DND a pessoa nunca soube da
-- ligação. Contar isso como recusa infla a métrica "o prospect me recusou" com
-- chamadas que ele não viu. `busy` é a leitura honesta — a linha estava
-- indisponível.
SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000006'),
          'busy', 'do_not_disturb → busy (indisponível, NÃO recusa humana)');

SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000007'),
          'failed', 'failed → failed');

-- `unknown` é marcador de ignorância, não causa. Vai para `failed` porque é a
-- única gaveta honesta entre as nove: não conectou, não houve recusa
-- identificada, não houve ocupado. A causa crua continua em voip_calls.
SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000008'),
          'failed', 'unknown → failed (ignorância, não causa)');

-- `rejected` não está no vocabulário da VPS: quem escreve é torquecalls-signal
-- quando o OPERADOR recusa a chamada de entrada. Sem este caso o mapeamento
-- cairia no ELSE e viraria `failed` — uma recusa deliberada contada como falha
-- técnica.
SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000009'),
          'rejected', 'rejected (operador recusou a entrada) → rejected');

SELECT is((SELECT outcome FROM public.call_logs WHERE voip_call_id='c0000013-0000-0000-0000-000000000010'),
          'canceled', 'user_ended SEM atendimento → canceled (o operador desistiu)');

-- ===========================================================================
-- (3) DURAÇÃO DE NÃO ATENDIDA É AUSÊNCIA, NÃO ZERO
-- ===========================================================================
-- `0` é um valor MEDIDO ("a conversa durou zero segundos") e entra em
-- `avg(duration_seconds)` puxando a média de conversa para baixo. `NULL` é
-- "não houve conversa para medir", e `avg()` o ignora de graça. É também o que
-- o registro manual (LogCallModal) já escreve quando ninguém digita duração.
SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id IN ('c0000013-0000-0000-0000-000000000002',
                           'c0000013-0000-0000-0000-000000000003',
                           'c0000013-0000-0000-0000-000000000004',
                           'c0000013-0000-0000-0000-000000000010')
      AND duration_seconds IS NOT NULL),
  0,
  'não atendida: duration_seconds é NULO (não 0) — ausência de conversa, não conversa de zero'
);

SELECT results_eq(
  $$SELECT started_at = (SELECT authorized_at FROM public.voip_calls
                          WHERE id = 'c0000013-0000-0000-0000-000000000002')
      FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000002'$$,
  $$VALUES (true)$$,
  'não atendida: started_at cai em authorized_at'
);

-- ===========================================================================
-- (4) BORDAS DA IDENTIDADE
-- ===========================================================================
UPDATE public.voip_calls SET status='ended', end_reason='user_ended',
       ended_at = now() - interval '1 minute'
 WHERE id = 'c0000013-0000-0000-0000-000000000011';

SELECT results_eq(
  $$SELECT user_id, direction, outcome, duration_seconds
      FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000011'$$,
  $$VALUES (NULL::uuid, 'inbound'::text, 'connected'::text, 180)$$,
  'chamada de ENTRADA sem operador: linha criada com user_id NULO (a coluna aceita)'
);

UPDATE public.voip_calls SET status='ended', end_reason='timeout', ended_at=now()
 WHERE id = 'c0000013-0000-0000-0000-000000000012';

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000012' AND lead_id IS NULL),
  1,
  'chamada sem lead: a linha existe mesmo assim, com lead_id NULO'
);

-- ===========================================================================
-- (5) A LINHA APARECE NA LINHA DO TEMPO DO LEAD — E COM A ORIGEM HONESTA
-- ===========================================================================
-- `trg_call_log_history` já existia: todo INSERT em call_logs vira
-- `lead_history`. A projeção herda isso de graça, que é o ponto — a chamada
-- passa a existir onde o vendedor olha.
SELECT is(
  (SELECT count(*)::int FROM public.lead_history
    WHERE lead_id = '13000000-0000-0000-0000-0000000000e1' AND action = 'call_logged'),
  11,
  'cada chamada projetada com lead rendeu UMA entrada na linha do tempo'
);

SELECT results_eq(
  $$SELECT DISTINCT source FROM public.lead_history
     WHERE lead_id = '13000000-0000-0000-0000-0000000000e1' AND action = 'call_logged'$$,
  $$VALUES ('system'::text)$$,
  'ligação projetada entra como source=system — chamar de manual seria mentira'
);

-- E o caminho manual (LogCallModal) segue sendo `manual`: a correção é
-- cirúrgica, não uma troca de rótulo para todo mundo.
INSERT INTO public.call_logs
  (organization_id, lead_id, user_id, direction, outcome, phone_number)
VALUES ('13000000-0000-0000-0000-000000000013', '13000000-0000-0000-0000-0000000000e1',
        'a0000013-0000-0000-0000-000000000001', 'outbound', 'voicemail', '5548991005289');

SELECT is(
  (SELECT count(*)::int FROM public.lead_history
    WHERE lead_id = '13000000-0000-0000-0000-0000000000e1'
      AND action = 'call_logged' AND source = 'manual'),
  1,
  'registro manual continua entrando como source=manual'
);

-- ===========================================================================
-- (6) PORTA 2 — O VARREDOR, PELO COMANDO LITERAL DO cron.job
-- ===========================================================================
-- Extraído de cron.job em tempo de teste, não reescrito aqui: se alguém mudar
-- o varredor sem passar por este arquivo, é o comando real que roda.
DO $sweep_runner$
DECLARE v_command text;
BEGIN
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'voip-sweep-stuck-calls';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'voip-sweep-stuck-calls não está em cron.job — nada para testar';
  END IF;
  EXECUTE v_command;
END
$sweep_runner$;

SELECT results_eq(
  $$SELECT outcome, duration_seconds FROM public.call_logs
     WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000013'$$,
  $$VALUES ('failed'::text, NULL::integer)$$,
  'PORTA 2 (varredor): no_terminal_event sem atendimento → failed, sem duração'
);

-- O varredor também recolhe chamada CONECTADA depois de 2 h, e essa foi
-- conversa de verdade. `connected_at IS NOT NULL` manda, não o motivo do fim —
-- é exatamente por isso que a regra não sai de `end_reason` sozinha.
SELECT results_eq(
  $$SELECT outcome, duration_seconds FROM public.call_logs
     WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000014'$$,
  $$VALUES ('connected'::text, 10800)$$,
  'PORTA 2: no_terminal_event COM atendimento → connected e 3 h de conversa'
);

-- ===========================================================================
-- (7) PORTA 3 — O WEBHOOK, PELA RPC DE VERDADE
-- ===========================================================================
SELECT is(
  public.fn_voip_apply_vps_event(
    '5e000013-0000-0000-0000-000000000015'::uuid, 'sess-s13-projecao', 1, 10, now(),
    jsonb_build_object('type', 'call-ended', 'id', 'S13CALL000000000000000000000015',
                       'reason', 'cancelled',
                       'endedAt', (extract(epoch FROM now()) * 1000)::bigint)
  ) ->> 'detail',
  'ended',
  'PORTA 3: a RPC do webhook aplica o fim da chamada'
);

SELECT results_eq(
  $$SELECT outcome, duration_seconds FROM public.call_logs
     WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000015'$$,
  $$VALUES ('canceled'::text, NULL::integer)$$,
  'PORTA 3: a chamada fechada pelo webhook chega em call_logs com a grafia traduzida'
);

-- ===========================================================================
-- (8) IDEMPOTÊNCIA
-- ===========================================================================
-- (8a) A própria função de projeção, chamada duas vezes de novo. É a prova
-- direta: mesma chamada, mesma linha, MESMO id — não recriou.
CREATE TEMP TABLE s13_marca AS
SELECT id AS log_id FROM public.call_logs
 WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001';

SELECT public.fn_voip_project_call_log('c0000013-0000-0000-0000-000000000001'::uuid);
SELECT public.fn_voip_project_call_log('c0000013-0000-0000-0000-000000000001'::uuid);

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'),
  1,
  'IDEMPOTÊNCIA: projetar a mesma chamada 3× no total NÃO duplica a linha'
);

SELECT is(
  (SELECT c.id FROM public.call_logs c WHERE c.voip_call_id = 'c0000013-0000-0000-0000-000000000001'),
  (SELECT m.log_id FROM s13_marca m),
  'IDEMPOTÊNCIA: o id da linha é preservado — é UPDATE no lugar, não linha nova'
);

-- E a linha do tempo não ganhou eco: `trg_call_log_history` é AFTER INSERT, e
-- `ON CONFLICT DO UPDATE` não dispara trigger de INSERT para a linha que foi
-- atualizada. Sem isso, cada reentrega do webhook viraria um "Ligação
-- realizada" repetido na tela do vendedor.
SELECT is(
  (SELECT count(*)::int FROM public.lead_history
    WHERE lead_id = '13000000-0000-0000-0000-0000000000e1'
      AND action = 'call_logged'
      AND metadata->>'phone_number' = '5548991005289'
      AND (metadata->>'outcome') = 'connected'
      AND created_by = 'a0000013-0000-0000-0000-000000000001'),
  1,
  'IDEMPOTÊNCIA: reprojetar NÃO ecoa na linha do tempo do lead'
);

-- (8b) Reentrega do MESMO envelope pelo webhook.
SELECT is(
  public.fn_voip_apply_vps_event(
    '5e000013-0000-0000-0000-000000000015'::uuid, 'sess-s13-projecao', 1, 10, now(),
    jsonb_build_object('type', 'call-ended', 'id', 'S13CALL000000000000000000000015',
                       'reason', 'cancelled',
                       'endedAt', (extract(epoch FROM now()) * 1000)::bigint)
  ) ->> 'code',
  'replay',
  'IDEMPOTÊNCIA: a reentrega do mesmo envelope é reconhecida como replay'
);

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000015'),
  1,
  'IDEMPOTÊNCIA: a reentrega não produziu segunda linha'
);

-- (8c) VARREDOR e DEPOIS webhook com a causa verdadeira. Duas portas fecharam
-- a MESMA chamada, em sequência — o caso que uma projeção presa a uma delas
-- resolveria errado. O varredor já projetou `failed`; a causa real chega
-- depois e o registro tem que ser CORRIGIDO no lugar.
SELECT is(
  (SELECT outcome FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000016'),
  'failed',
  'ANTES da correção: a chamada recolhida pelo varredor está registrada como failed'
);

SELECT is(
  public.fn_voip_apply_vps_event(
    '5e000013-0000-0000-0000-000000000016'::uuid, 'sess-s13-projecao', 1, 20, now(),
    jsonb_build_object('type', 'call-ended', 'id', 'S13CALL000000000000000000000016',
                       'reason', 'declined',
                       'endedAt', (extract(epoch FROM now()) * 1000)::bigint)
  ) ->> 'detail',
  'sweeper_reason_corrected',
  'o webhook substitui o chute do varredor pela causa verdadeira'
);

SELECT results_eq(
  $$SELECT count(*)::int, max(outcome) FROM public.call_logs
     WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000016'$$,
  $$VALUES (1, 'rejected'::text)$$,
  'varredor + webhook: UMA linha, corrigida no lugar para rejected'
);

-- (8d) Carimbo TARDIO de `connected_at` numa linha JÁ encerrada. A faixa tardia
-- do S11 preenche connected_at depois do fim; sem reprojetar, a chamada ficaria
-- registrada para sempre como não atendida sendo que atendeu.
UPDATE public.voip_calls
   SET status='ended', end_reason='unknown', ended_at = now(),
       last_seq_epoch = 9, last_seq = 99
 WHERE id = 'c0000013-0000-0000-0000-000000000017';

SELECT is(
  (SELECT outcome FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000017'),
  'failed',
  'ANTES do carimbo tardio: sem connected_at, a chamada é failed'
);

SELECT is(
  public.fn_voip_apply_vps_event(
    '5e000013-0000-0000-0000-000000000017'::uuid, 'sess-s13-projecao', 9, 5, now(),
    jsonb_build_object('type', 'call-status', 'id', 'S13CALL000000000000000000000017',
                       'status', 'connected')
  ) ->> 'detail',
  'late_connected_at',
  'a faixa tardia do S11 preenche connected_at depois do fim'
);

SELECT results_eq(
  $$SELECT count(*)::int, max(outcome) FROM public.call_logs
     WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000017'$$,
  $$VALUES (1, 'connected'::text)$$,
  'carimbo tardio: a MESMA linha vira connected — atendeu, e o registro passa a dizer isso'
);

-- ===========================================================================
-- (9) O QUE NÃO PODE DISPARAR
-- ===========================================================================
-- Marcador plantado à mão: se o gatilho reprojetar, ele é reescrito pelo
-- mapeamento. Sobreviver é a prova de que UPDATE que não mexe em status,
-- motivo nem carimbo não reprojeta.
UPDATE public.call_logs SET outcome = 'voicemail'
 WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001';

UPDATE public.voip_calls SET last_seq = last_seq + 1, updated_at = now()
 WHERE id = 'c0000013-0000-0000-0000-000000000001';

SELECT is(
  (SELECT outcome FROM public.call_logs WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000001'),
  'voicemail',
  'UPDATE que só move marca d`água/updated_at NÃO reprojeta'
);

-- Reserva vencida não é ligação: ninguém discou, nada tocou. Registrá-la
-- encheria o histórico do lead de não-eventos.
UPDATE public.voip_calls SET status='expired', end_reason='reservation_expired', ended_at=now()
 WHERE id = 'c0000013-0000-0000-0000-000000000018';

SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_call_id = 'c0000013-0000-0000-0000-000000000018'),
  0,
  'reserva vencida (status expired) NÃO vira registro de ligação'
);

-- Chamada ainda viva também não. `fn_voip_project_call_log` é a única porta de
-- escrita e ela mesma recusa o que não terminou — o gatilho é fiação, não
-- autoridade.
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status, authorized_at, ringing_at)
VALUES ('c0000013-0000-0000-0000-000000000019', '13000000-0000-0000-0000-000000000013',
        'sess-s13-projecao', 'S13CALL000000000000000000000019', '13000000-0000-0000-0000-0000000000e1',
        'a0000013-0000-0000-0000-000000000019', '5548991005289', 'outbound', 'ringing',
        now(), now());

SELECT is(
  public.fn_voip_project_call_log('c0000013-0000-0000-0000-000000000019'::uuid),
  NULL::uuid,
  'chamada viva não é projetada nem quando a função é chamada à mão'
);

-- ===========================================================================
-- (10) TODAS AS 9 SAÍDAS RESPEITAM O CHECK DO BANCO
-- ===========================================================================
-- Guarda de conjunto: qualquer motivo novo do vocabulário da VPS que caia num
-- valor fora do CHECK levantaria exceção DENTRO da transação do webhook. Esta
-- asserção varre o que foi produzido de verdade nesta suíte.
SELECT is(
  (SELECT count(*)::int FROM public.call_logs
    WHERE voip_provider = 'torquecalls'
      AND outcome NOT IN ('connected','no_answer','busy','voicemail','wrong_number',
                          'callback_scheduled','rejected','failed','canceled')),
  0,
  'nenhum outcome projetado está fora do CHECK de call_logs'
);

SELECT is(
  (SELECT count(*)::int FROM public.call_logs WHERE voip_provider = 'torquecalls'),
  17,
  'dezessete chamadas encerradas, dezessete registros — nenhuma sobrou de fora'
);

SELECT * FROM finish();
ROLLBACK;

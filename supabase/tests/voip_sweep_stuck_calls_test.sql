BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos. Sem esta linha, `SELECT plan(...)` estoura com "function plan(integer)
-- does not exist".
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova o varredor de chamada sem evento terminal
-- (20270730000007_voip_sweep_stuck_calls.sql).
--
-- O que está em jogo: `idx_voip_calls_one_live_per_operator` trava o operador em
-- QUALQUER linha `authorized`/`ringing`/`connected` dele. Hoje nada escreve a
-- transição terminal de uma chamada que não termina pelo botão de desligar — o
-- varredor é a única coisa que devolve esse operador. Duas asserções importam
-- mais que as outras: (1) a linha velha É recolhida — sem isso o operador fica
-- preso para sempre; (2) a linha RECENTE não é — sem isso o varredor vira um
-- cortador de ligação viva, defeito pior que o que ele conserta.
SELECT plan(13);

-- O que se mede tem que ser o que roda de verdade: o job existe, está ativo, e
-- roda a cada minuto. Se este assert cair, os que seguem estão testando um
-- comando que produção não executa.
SELECT ok(
  EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'voip-sweep-stuck-calls'
       AND active = true
       AND schedule = '* * * * *'
  ),
  'voip-sweep-stuck-calls está agendado, ativo, a cada minuto'
);

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- whatsapp_instances tem trg_enforce_whatsapp_instance_limit BEFORE INSERT, que
-- chama org_resolve_quota -> assert_org_access(p_org_id). Rodando como postgres
-- via psql (sem JWT), isso levanta P0001 access_denied. leads tem 20 triggers
-- (webhooks, workflows, sync de pipe) que não interessam a este teste. Mesmo
-- tratamento de voip_foundation_test.sql:167 e voip_call_id_provenance_test.sql:50.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
VALUES
  ('a0000001-0000-0000-0000-000000000001', 'op-ringing-velho@voip.test'),
  ('a0000001-0000-0000-0000-000000000002', 'op-ringing-recente@voip.test'),
  ('a0000001-0000-0000-0000-000000000003', 'op-connected-velho@voip.test'),
  ('a0000001-0000-0000-0000-000000000004', 'op-connected-recente@voip.test');

INSERT INTO public.organizations (id, name, slug)
VALUES ('99999999-9999-9999-9999-999999999999', 'Org Varredor Teste', 'org-varredor-teste');

-- daily_call_cap NULL: o teto diário é opcional desde 20270730000003. Nenhuma
-- asserção deste arquivo é sobre cota, e um cap explícito só adicionaria um jeito
-- de o teste falhar por motivo errado.
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
        'inst-varredor-teste', true, NULL);

INSERT INTO public.voip_sessions (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
        'sess-varredor-teste', 'TorqueCalls', 'open');

INSERT INTO public.leads (id, organization_id, name, phone)
VALUES ('77777777-7777-7777-7777-777777777777', '99999999-9999-9999-9999-999999999999',
        'Lead Varredor', '5548991005289');

INSERT INTO public.consent_records (organization_id, lead_id, consent_type, granted, source)
VALUES ('99999999-9999-9999-9999-999999999999', '77777777-7777-7777-7777-777777777777',
        'voice_call_whatsapp', true, 'form');

SET LOCAL session_replication_role = origin;

-- Quatro linhas, uma por operador/cenário. Sem trigger de INSERT em voip_calls
-- (conferido: 0 triggers não-internos), então os carimbos de tempo são exatos,
-- o que a asserção de fronteira (2min / 2h) exige.
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status, authorized_at, ringing_at, connected_at)
VALUES
  -- ringing há 10 minutos (> 2min): ALVO do varredor.
  ('c0000001-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999',
   'sess-varredor-teste', 'AAAA000000000000000000000000AAA1', '77777777-7777-7777-7777-777777777777',
   'a0000001-0000-0000-0000-000000000001', '5548991005289', 'outbound', 'ringing',
   now() - interval '10 minutes', now() - interval '10 minutes', NULL),
  -- ringing há 30 segundos (< 2min): NÃO é alvo. A asserção que impede o
  -- varredor de virar cortador de ligação viva.
  ('c0000001-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999',
   'sess-varredor-teste', 'AAAA000000000000000000000000AAA2', '77777777-7777-7777-7777-777777777777',
   'a0000001-0000-0000-0000-000000000002', '5548991005289', 'outbound', 'ringing',
   now() - interval '30 seconds', now() - interval '30 seconds', NULL),
  -- connected há 3 horas (> 2h): ALVO do varredor.
  ('c0000001-0000-0000-0000-000000000003', '99999999-9999-9999-9999-999999999999',
   'sess-varredor-teste', 'AAAA000000000000000000000000AAA3', '77777777-7777-7777-7777-777777777777',
   'a0000001-0000-0000-0000-000000000003', '5548991005289', 'outbound', 'connected',
   now() - interval '4 hours', now() - interval '4 hours', now() - interval '3 hours'),
  -- connected há 10 minutos (< 2h): NÃO é alvo.
  ('c0000001-0000-0000-0000-000000000004', '99999999-9999-9999-9999-999999999999',
   'sess-varredor-teste', 'AAAA000000000000000000000000AAA4', '77777777-7777-7777-7777-777777777777',
   'a0000001-0000-0000-0000-000000000004', '5548991005289', 'outbound', 'connected',
   now() - interval '4 hours', now() - interval '4 hours', now() - interval '10 minutes');

-- ===========================================================================
-- (1) ANTES DO VARREDOR: os quatro operadores estão presos.
-- ===========================================================================
-- `idx_voip_calls_one_live_per_operator` é o que trava — provar isso aqui
-- estabelece a baseline que o varredor tem que desfazer para os dois primeiros
-- e PRESERVAR para os dois últimos.

SELECT is(
  public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000001',
    'sess-varredor-teste', '5548991005280', '77777777-7777-7777-7777-777777777777'
  ) ->> 'code',
  'operator_busy',
  'ANTES: operador com ringing velho está preso'
);

SELECT is(
  public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000002',
    'sess-varredor-teste', '5548991005280', '77777777-7777-7777-7777-777777777777'
  ) ->> 'code',
  'operator_busy',
  'ANTES: operador com ringing recente está preso'
);

SELECT is(
  public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000003',
    'sess-varredor-teste', '5548991005280', '77777777-7777-7777-7777-777777777777'
  ) ->> 'code',
  'operator_busy',
  'ANTES: operador com connected velho está preso'
);

SELECT is(
  public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000004',
    'sess-varredor-teste', '5548991005280', '77777777-7777-7777-7777-777777777777'
  ) ->> 'code',
  'operator_busy',
  'ANTES: operador com connected recente está preso'
);

-- ===========================================================================
-- (2) RODA O VARREDOR — LITERALMENTE O QUE cron.job REGISTROU
-- ===========================================================================
-- Não uma cópia reescrita da migration: o comando é extraído de cron.job em
-- tempo de teste e executado via EXECUTE. Se alguém editar o cron sem repassar
-- por aqui, ou se o `cron.schedule` da migration divergir do que este arquivo
-- assume, é o comando real que roda — não uma suposição sobre ele.
DO $sweep_runner$
DECLARE
  v_command text;
BEGIN
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'voip-sweep-stuck-calls';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'voip-sweep-stuck-calls não está em cron.job — nada para testar';
  END IF;
  EXECUTE v_command;
END
$sweep_runner$;

-- ===========================================================================
-- (3) DEPOIS: as duas linhas velhas foram recolhidas; as duas recentes, não.
-- ===========================================================================

SELECT results_eq(
  $$SELECT status, end_reason FROM public.voip_calls
     WHERE id = 'c0000001-0000-0000-0000-000000000001'$$,
  $$VALUES ('ended'::text, 'no_terminal_event'::text)$$,
  'ringing velho foi recolhido como ended/no_terminal_event'
);

SELECT results_eq(
  $$SELECT status, end_reason FROM public.voip_calls
     WHERE id = 'c0000001-0000-0000-0000-000000000002'$$,
  $$VALUES ('ringing'::text, NULL::text)$$,
  'ringing recente NÃO foi tocado'
);

SELECT results_eq(
  $$SELECT status, end_reason FROM public.voip_calls
     WHERE id = 'c0000001-0000-0000-0000-000000000003'$$,
  $$VALUES ('ended'::text, 'no_terminal_event'::text)$$,
  'connected velho foi recolhido como ended/no_terminal_event'
);

SELECT results_eq(
  $$SELECT status, end_reason FROM public.voip_calls
     WHERE id = 'c0000001-0000-0000-0000-000000000004'$$,
  $$VALUES ('connected'::text, NULL::text)$$,
  'connected recente NÃO foi tocado'
);

-- ===========================================================================
-- (4) O PONTO INTEIRO: os operadores recolhidos voltam a reservar; os que
--     seguem em ligação viva continuam presos.
-- ===========================================================================

SELECT is(
  (public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000001',
    'sess-varredor-teste', '5548991005281', '77777777-7777-7777-7777-777777777777'
  ) ->> 'ok')::boolean,
  true,
  'DEPOIS: operador do ringing velho volta a reservar'
);

SELECT is(
  (public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000003',
    'sess-varredor-teste', '5548991005281', '77777777-7777-7777-7777-777777777777'
  ) ->> 'ok')::boolean,
  true,
  'DEPOIS: operador do connected velho volta a reservar'
);

SELECT is(
  public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000002',
    'sess-varredor-teste', '5548991005281', '77777777-7777-7777-7777-777777777777'
  ) ->> 'code',
  'operator_busy',
  'DEPOIS: operador do ringing recente CONTINUA preso — a chamada dele está viva'
);

SELECT is(
  public.fn_voip_call_reserve(
    '99999999-9999-9999-9999-999999999999', 'a0000001-0000-0000-0000-000000000004',
    'sess-varredor-teste', '5548991005281', '77777777-7777-7777-7777-777777777777'
  ) ->> 'code',
  'operator_busy',
  'DEPOIS: operador do connected recente CONTINUA preso — a chamada dele está viva'
);

SELECT * FROM finish();
ROLLBACK;

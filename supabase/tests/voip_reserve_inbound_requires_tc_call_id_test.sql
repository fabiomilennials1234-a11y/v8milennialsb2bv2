BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos. Sem esta linha, `SELECT plan(...)` estoura com "function plan(integer)
-- does not exist".
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Prova o predicado do ramo de entrada de fn_voip_call_reserve
-- (20270730000008_voip_reserve_inbound_requires_tc_call_id.sql, achado I1).
--
-- O DEFEITO que isto impede: atender uma chamada de entrada cuja linha ainda
-- não tem `tc_call_id` gravava `operator_user_id` na linha (status `ringing`)
-- e SÓ DEPOIS o CRM negava — dentro do UNIQUE parcial
-- `idx_voip_calls_one_live_per_operator`. O operador ficava consumido por uma
-- chamada que ele nunca atendeu. A correção move a checagem para o WHERE do
-- UPDATE: a negativa passa a ser pura, sem efeito colateral.
SELECT plan(7);

-- ANTI-REGRESSÃO. Esta migration recria a função inteira, partindo do corpo
-- vigente de 20270730000006 (não da fundação nem de 20270730000003 sozinha) —
-- copiar da fundação reimporia em silêncio os tetos que o CTO removeu, e nenhuma
-- outra asserção deste arquivo pegaria isso porque a semente não encosta em
-- limiar nenhum.
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'AND tc_call_id IS NOT NULL',
  'o WHERE do UPDATE de entrada exige tc_call_id'
);
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_max_org_live\s+constant integer\s+:= 100',
  'os disjuntores da decisão sem-teto sobrevivem à recriação'
);

-- ===========================================================================
-- SEMENTE
-- ===========================================================================
-- whatsapp_instances tem trg_enforce_whatsapp_instance_limit BEFORE INSERT, que
-- chama org_resolve_quota -> assert_org_access(p_org_id). Rodando como postgres
-- via psql (sem JWT), isso levanta P0001 access_denied. Mesmo tratamento de
-- voip_call_id_provenance_test.sql:50.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
VALUES ('a0000002-0000-0000-0000-000000000001', 'op-atende@voip.test');

INSERT INTO public.organizations (id, name, slug)
VALUES ('66666666-6666-6666-6666-666666666666', 'Org Entrada Teste', 'org-entrada-teste');

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
        'inst-entrada-teste', true, NULL);

INSERT INTO public.voip_sessions (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',
        'sess-entrada-teste', 'TorqueCalls', 'open');

SET LOCAL session_replication_role = origin;

-- Duas linhas de entrada, ambas nascidas `ringing` sem operador — o estado real
-- de uma chamada de entrada antes de ser atendida.
--
-- SEM id de rede: o caso do achado I1.
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status)
VALUES
  ('44444444-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666',
   'sess-entrada-teste', NULL, NULL, NULL, '5548991005282', 'inbound', 'ringing');

-- COM id de rede: controle positivo. Sem ele, uma negativa constante (por
-- exemplo um bug que sempre nega) passaria vacuamente — a mesma lição do
-- comentário sobre `is()`/NULL em voip_call_id_provenance_test.sql.
INSERT INTO public.voip_calls
  (id, organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
   peer_phone, direction, status)
VALUES
  ('44444444-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666',
   'sess-entrada-teste', 'BBBB000000000000000000000000BBB1', NULL, NULL,
   '5548991005283', 'inbound', 'ringing');

-- ===========================================================================
-- CASO NEGATIVO — sem tc_call_id
-- ===========================================================================

CREATE TEMP TABLE tentativa_sem_tc_call_id AS
SELECT public.fn_voip_call_reserve(
  '66666666-6666-6666-6666-666666666666'::uuid,
  'a0000002-0000-0000-0000-000000000001'::uuid,
  'sess-entrada-teste', '5511999999999',
  NULL, 'inbound', NULL,
  '44444444-0000-0000-0000-000000000001'::uuid
) AS r;

SELECT is(
  (SELECT r ->> 'code' FROM tentativa_sem_tc_call_id),
  'call_not_answerable',
  'atender chamada de entrada sem tc_call_id devolve call_not_answerable'
);

-- `ok(x IS NULL)`, não `is(a,b)`: operator_user_id já nascia NULL, então a
-- asserção certa é que ELE CONTINUA NULO depois da tentativa — não que dois
-- NULLs são iguais.
SELECT ok(
  (SELECT operator_user_id FROM public.voip_calls
    WHERE id = '44444444-0000-0000-0000-000000000001') IS NULL,
  'SEM EFEITO COLATERAL: operator_user_id continua nulo depois da negativa'
);

SELECT is(
  (SELECT status FROM public.voip_calls
    WHERE id = '44444444-0000-0000-0000-000000000001'),
  'ringing',
  'SEM EFEITO COLATERAL: status continua ringing — o UPDATE não tocou a linha'
);

-- ===========================================================================
-- CONTROLE POSITIVO — com tc_call_id, a mesma chamada é atendível
-- ===========================================================================

CREATE TEMP TABLE tentativa_com_tc_call_id AS
SELECT public.fn_voip_call_reserve(
  '66666666-6666-6666-6666-666666666666'::uuid,
  'a0000002-0000-0000-0000-000000000001'::uuid,
  'sess-entrada-teste', '5511999999999',
  NULL, 'inbound', NULL,
  '44444444-0000-0000-0000-000000000002'::uuid
) AS r;

SELECT is(
  (SELECT (r ->> 'ok')::boolean FROM tentativa_com_tc_call_id),
  true,
  'a mesma chamada, COM tc_call_id, é atendível'
);

SELECT is(
  (SELECT operator_user_id FROM public.voip_calls
    WHERE id = '44444444-0000-0000-0000-000000000002'),
  'a0000002-0000-0000-0000-000000000001'::uuid,
  'com tc_call_id, operator_user_id É gravado — prova que o predicado, e não outra coisa, barrou o caso negativo'
);

SELECT * FROM finish();
ROLLBACK;

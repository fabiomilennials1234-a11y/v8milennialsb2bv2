BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos. Sem esta linha, `SELECT plan(...)` estoura com "function plan(integer)
-- does not exist". Os 31 arquivos de suíte deste diretório têm a linha.
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- A RPC responde com código em vez de estourar quando a sessão não existe.
SELECT ok(
  (SELECT public.fn_voip_call_reserve(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     'sess-inexistente', '5511999999999',
     NULL, 'outbound', NULL, NULL
   )) ? 'code',
  'chamada com sessão inexistente devolve code, não estoura'
);

-- A coluna existe e continua nullable (chamada de entrada nasce sem ela até o S11).
SELECT col_is_null('public', 'voip_calls', 'tc_call_id', 'tc_call_id continua nullable');

-- O GRANT não pode ter sido perdido na recriação da função.
SELECT ok(
  has_function_privilege('service_role',
    'public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid)', 'EXECUTE'),
  'service_role mantém EXECUTE depois do CREATE OR REPLACE'
);

-- ANTI-REGRESSÃO. Esta migration recria a função inteira, e a versão vigente é a
-- de 20270730000003 ("sem teto de volume"), não a da fundação. Copiar da fundação
-- reimporia em silêncio os tetos que o CTO removeu em 2026-07-30 — e nenhuma
-- outra asserção deste arquivo pegaria isso, porque a semente faz UMA chamada e
-- não encosta em limiar nenhum.
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_max_org_live\s+constant integer\s+:= 100',
  'os disjuntores da decisão sem-teto sobrevivem à recriação'
);

-- OBRIGATÓRIO antes da semente. whatsapp_instances tem
-- trg_enforce_whatsapp_instance_limit BEFORE INSERT, que chama org_resolve_quota,
-- que começa com PERFORM public.assert_org_access(p_org_id). Rodando como
-- postgres via psql (auth.role() e auth.uid() nulos, org sem membro), isso levanta
-- P0001 access_denied — e com ON_ERROR_STOP=1, que o run.sh usa, o arquivo inteiro
-- aborta antes de qualquer asserção. Mesmo passando o gate, a org semeada não tem
-- plano nem org_quotas, então o limite resolveria 0 e o trigger recusaria.
-- É o mesmo tratamento que voip_foundation_test.sql:167 já usa.
SET LOCAL session_replication_role = replica;

-- Semente mínima. organizations exige name E slug (os dois NOT NULL sem default).
INSERT INTO public.organizations (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Org de teste', 'org-de-teste')
ON CONFLICT (id) DO NOTHING;

-- voice_calls_enabled tem default false: sem true explícito a reserva devolve
-- voice_calls_disabled. daily_call_cap é nullable e sem default; explícito para
-- o teste não depender de comparação com NULL.
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'inst-teste', true, 100)
ON CONFLICT (id) DO NOTHING;

-- status='open' é exigido pela reserva (20270730000000:519).
INSERT INTO public.voip_sessions (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'sess-teste', 'TorqueCalls', 'open')
ON CONFLICT (tc_session_id) DO NOTHING;

-- De volta ao runtime real ANTES das asserções: o que se mede tem que ser o
-- comportamento com triggers ligados.
SET LOCAL session_replication_role = origin;

-- Assinatura, na ordem exata de 20270730000000:454-462:
--   p_organization_id, p_operator_user_id, p_tc_session_id, p_peer_phone,
--   p_lead_id, p_direction, p_consent_record_id, p_existing_call_id
CREATE TEMP TABLE reserva AS
SELECT public.fn_voip_call_reserve(
  '11111111-1111-1111-1111-111111111111'::uuid,  -- org
  NULL,                                          -- operador (inbound nasce sem)
  'sess-teste',                                  -- sessão
  '5511999999999',                               -- peer
  NULL,                                          -- lead: inbound não exige
  'inbound',                                     -- direção
  NULL,                                          -- consentimento: inbound não exige
  NULL                                           -- sem linha prévia: cai no INSERT
) AS r;

SELECT is((SELECT (r->>'ok')::boolean FROM reserva), true,
  'reserva de entrada é autorizada');

SELECT matches(
  (SELECT r->>'tc_call_id' FROM reserva),
  '^[0-9A-F]{32}$',
  'a RPC devolve tc_call_id no formato que a VPS aceita'
);

-- `ok(... IS NOT NULL AND ...)`, não `is(a, b)`. O `is()` do pgTAP usa
-- `NOT $1 IS DISTINCT FROM $2`, então NULL = NULL PASSA — e antes da migration os
-- dois lados são NULL. A asserção seria vacuamente verdadeira exatamente no
-- estado que ela existe para reprovar.
SELECT ok(
  (SELECT c.tc_call_id IS NOT NULL
      AND c.tc_call_id = (SELECT r->>'tc_call_id' FROM reserva)
     FROM public.voip_calls c
    WHERE c.id = (SELECT (r->>'call_id')::uuid FROM reserva)),
  'o tc_call_id devolvido foi gravado na linha, e não é nulo'
);

SELECT * FROM finish();
ROLLBACK;

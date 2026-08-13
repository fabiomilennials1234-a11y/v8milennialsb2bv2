-- supabase/tests/metric_custom_tree_test.sql
--
-- SCRUM-311 fatia 10 · SCRUM-316..320: MÉTRICA PERSONALIZADA.
-- Migration: 20270813110000_metric_custom_definitions.sql
-- Contrato: Emenda 1 do ADR-0023 (aceita 2026-08-11).
--
-- A emenda cria três obrigações, e esta suíte existe para cada uma:
--
--   1. VALIDAR NAS DUAS PONTAS — escrita (trigger) e runtime (motor). Um lado
--      só não basta: a linha gravada sobrevive a mudança de validador. O bloco
--      (RT) planta uma árvore inválida COM O TRIGGER DESLIGADO e prova que o
--      motor a recusa mesmo assim.
--   2. FALHAR ALTO — árvore inválida levanta 22023, nunca devolve null
--      passando por número. Blocos (ER).
--   3. pgTAP POR OPERADOR E PARA O TETO, incluindo profundidade 4 recusada.
--      Blocos (OP) e (PF).
--
-- 🔴 O BLOCO QUE MAIS IMPORTA É (TR): A ARMADILHA DE 100×
--
-- O ramo `kind='ratio'` do motor deriva `count/count → percent` e MULTIPLICA
-- por 100; o front apenas SUFIXA '%'. O par casa nas razões semeadas e some no
-- dia em que alguém montar "negócios por lead" — 2,5 sairia como "250,0%", e
-- nada no sistema detectaria.
--
-- Na árvore personalizada, `count ÷ count` deriva RATIO e o motor NÃO
-- multiplica. (TR1) afirma o número cru; (TR2) afirma a unidade; (TR3) prova
-- que quem QUER percentual consegue — escrevendo `× 100` na própria árvore.
-- Se algum dia (TR1) devolver 250, a armadilha voltou.
--
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('39140000-0000-4000-8000-00000000000a', 'Org CT A', 'org-ct-a', 'America/Sao_Paulo'),
  ('39140000-0000-4000-8000-00000000000b', 'Org CT B', 'org-ct-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3914115e-0000-4000-8000-00000000000a', 'user-3914a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3914115e-0000-4000-8000-0000000000ad', 'user-3914ad@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3914115e-0000-4000-8000-00000000000b', 'user-3914b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Um 'member' e um 'admin' na MESMA org: a diferença entre os dois é o que a
-- RLS de escrita separa, e (RL) exercita os dois lados.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('39141ea9-0000-4000-8000-00000000000a', '39140000-0000-4000-8000-00000000000a',
   '3914115e-0000-4000-8000-00000000000a', 'Membro CT A', 'member', true),
  ('39141ea9-0000-4000-8000-0000000000ad', '39140000-0000-4000-8000-00000000000a',
   '3914115e-0000-4000-8000-0000000000ad', 'Admin CT A', 'admin', true),
  ('39141ea9-0000-4000-8000-00000000000b', '39140000-0000-4000-8000-00000000000b',
   '3914115e-0000-4000-8000-00000000000b', 'Membro CT B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('39149191-0000-4000-8000-00000000000a', '39140000-0000-4000-8000-00000000000a',
   'Funil CT A', 'funil-ct-a', 'custom', true)
ON CONFLICT (id) DO NOTHING;

-- Org A, agosto/2027:  5 leads criados · 2 vendas · R$ 4.000 de receita.
-- Os números foram escolhidos para que cada operador dê um resultado exato e
-- inconfundível: 5+2=7, 5−2=3, 5×2=10, 4000÷5=800, 5÷2=2,5.
INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at) VALUES
  ('3914ead1-0000-4000-8000-000000000001', '39140000-0000-4000-8000-00000000000a', 'Lead CT 1', 'meta_ads',  '2027-08-05T12:00:00Z', '2027-08-05T12:00:00Z'),
  ('3914ead1-0000-4000-8000-000000000002', '39140000-0000-4000-8000-00000000000a', 'Lead CT 2', 'meta_ads',  '2027-08-06T12:00:00Z', '2027-08-06T12:00:00Z'),
  ('3914ead1-0000-4000-8000-000000000003', '39140000-0000-4000-8000-00000000000a', 'Lead CT 3', 'indicacao', '2027-08-07T12:00:00Z', '2027-08-07T12:00:00Z'),
  ('3914ead1-0000-4000-8000-000000000004', '39140000-0000-4000-8000-00000000000a', 'Lead CT 4', 'indicacao', '2027-08-08T12:00:00Z', '2027-08-08T12:00:00Z'),
  ('3914ead1-0000-4000-8000-000000000005', '39140000-0000-4000-8000-00000000000a', 'Lead CT 5', 'meta_ads',  '2027-08-09T12:00:00Z', '2027-08-09T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sale_events (id, organization_id, lead_id, pipeline_id, stage_key,
                                event_type, sold_at, sale_value, currency, revenue_stream, source) VALUES
  ('39145a1e-0000-4000-8000-000000000001', '39140000-0000-4000-8000-00000000000a',
   '3914ead1-0000-4000-8000-000000000001', '39149191-0000-4000-8000-00000000000a', 'proposta',
   'sale', '2027-08-15T12:00:00Z', 2500.00, 'BRL', 'novo_negocio', 'backfill'),
  ('39145a1e-0000-4000-8000-000000000002', '39140000-0000-4000-8000-00000000000a',
   '3914ead1-0000-4000-8000-000000000002', '39149191-0000-4000-8000-00000000000a', 'proposta',
   'sale', '2027-08-16T12:00:00Z', 1500.00, 'BRL', 'novo_negocio', 'backfill')
ON CONFLICT (id) DO NOTHING;

-- Definições SALVAS. Entram com `session_replication_role = replica`, ou seja
-- com o trigger DESLIGADO — por isso `derived_unit` vem à mão aqui. É de
-- propósito: a segunda linha é INVÁLIDA e não passaria pelo trigger, e é
-- exatamente ela que prova a validação de RUNTIME em (RT).
INSERT INTO public.metric_custom_definitions
  (id, organization_id, name, tree, format_id, derived_unit) VALUES
  ('3914de40-0000-4000-8000-000000000001', '39140000-0000-4000-8000-00000000000a',
   'Receita por lead',
   '{"type":"op","op":"div","left":{"type":"measure","id":"receita"},"right":{"type":"measure","id":"leads_criados"}}'::jsonb,
   'currency_brl', 'currency'),
  -- Árvore com medida inexistente. Gravada por baixo do trigger, como uma
  -- linha antiga sobreviveria a um aperto de regra.
  ('3914de40-0000-4000-8000-0000000000ff', '39140000-0000-4000-8000-00000000000a',
   'Metrica legada quebrada',
   '{"type":"op","op":"div","left":{"type":"measure","id":"medida_que_nunca_existiu"},"right":{"type":"literal","value":2}}'::jsonb,
   'ratio_2', 'ratio'),
  -- Org B: existe para provar que A não a enxerga.
  ('3914de40-0000-4000-8000-0000000000b1', '39140000-0000-4000-8000-00000000000b',
   'Metrica da org B',
   '{"type":"measure","id":"leads_criados"}'::jsonb,
   'integer', 'count')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (SC) Schema e segurança da tabela
-- ===========================================================================
SELECT has_table('public', 'metric_custom_definitions',
  'SC1: a tabela existe');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'metric_custom_definitions'),
  'SC2: RLS ligada — sem ela, definição de uma org seria legível por qualquer autenticado');

SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'metric_custom_definitions'),
  4::bigint,
  'SC3: as 4 policies (select/insert/update/delete) estão de pé');

-- A helper de escrita NÃO pode ser `get_my_admin_organization_ids()`: aquela
-- inclui gestor de portfólio (ADR-0021), papel escopado a funis, que não
-- deveria definir métrica da organização inteira. Os nomes não distinguem.
SELECT is_empty(
  $$SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'metric_custom_definitions'
       AND cmd <> 'SELECT'
       AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%get_my_admin_organization_ids%'$$,
  'SC4: nenhuma policy de escrita usa a helper que inclui gestor de portfólio');

-- ===========================================================================
-- (GR) Grants
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int)'::regprocedure, 'EXECUTE'),
  'GR1: authenticated NÃO executa o avaliador — ele recebe org_id por parâmetro');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.fn_metric_tree_validate(jsonb)'::regprocedure, 'EXECUTE'),
  'GR2: anon não valida árvore');

SELECT ok(
  has_function_privilege('authenticated',
    'public.fn_metric_tree_validate(jsonb)'::regprocedure, 'EXECUTE'),
  'GR3: authenticated VALIDA — o compositor precisa dizer "não fecha" antes de gravar');

-- Invariante da Decisão 3 do ADR-0023, mantida intacta pela Emenda 1.
SELECT is_empty(
  $$SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_metric_measure','_metric_tree_eval','_metric_tree_unit',
                         'fn_metric_tree_validate','_metric_leaf')
       AND p.prosrc ~* '(^|[^_[:alnum:]])execute[[:space:]]'$$,
  'GR4: ZERO EXECUTE no motor — o grep que é gate do revisor');

-- ===========================================================================
-- (UN) Derivação de unidade — a tabela-verdade, direto
-- ===========================================================================
SELECT is(public._metric_tree_op_unit('div', 'count', 'count'), 'ratio',
  'UN1: count ÷ count é RAZÃO, não percentual — é aqui que a armadilha de 100× morre');
SELECT is(public._metric_tree_op_unit('div', 'currency', 'count'), 'currency',
  'UN2: dinheiro ÷ contagem é dinheiro');
SELECT is(public._metric_tree_op_unit('div', 'duration_seconds', 'count'), 'duration_seconds',
  'UN3: tempo ÷ contagem é tempo');
SELECT is(public._metric_tree_op_unit('div', 'currency', 'number'), 'currency',
  'UN4: dividir por literal preserva a unidade — "por dia útil"');
SELECT is(public._metric_tree_op_unit('mul', 'ratio', 'number'), 'ratio',
  'UN5: multiplicar por literal preserva a unidade — é assim que se faz percentual');
SELECT is(public._metric_tree_op_unit('add', 'count', 'count'), 'count',
  'UN6: somar contagens dá contagem');

SELECT throws_ok(
  $$SELECT public._metric_tree_op_unit('add', 'currency', 'count')$$,
  '22023', NULL,
  'UN7: somar dinheiro com contagem FALHA ALTO — não inventa unidade');

SELECT throws_ok(
  $$SELECT public._metric_tree_op_unit('mul', 'currency', 'count')$$,
  '22023', NULL,
  'UN8: multiplicar duas grandezas FALHA ALTO — produto de receita por contagem não é grandeza');

SELECT throws_ok(
  $$SELECT public._metric_tree_op_unit('pow', 'count', 'count')$$,
  '22023', NULL,
  'UN9: operador fora do conjunto enumerado é recusado');

-- ===========================================================================
-- (PF) O TETO DE PROFUNDIDADE — obrigação 3 da emenda
-- ===========================================================================
SELECT is(
  public.fn_metric_tree_validate(
    '{"type":"op","op":"div",
      "left":{"type":"op","op":"div",
        "left":{"type":"op","op":"div",
          "left":{"type":"measure","id":"receita"},
          "right":{"type":"literal","value":2}},
        "right":{"type":"literal","value":2}},
      "right":{"type":"literal","value":2}}'::jsonb),
  'currency',
  'PF1: profundidade 3 é ACEITA — é o teto medido contra os casos do grill');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate(
      '{"type":"op","op":"div",
        "left":{"type":"op","op":"div",
          "left":{"type":"op","op":"div",
            "left":{"type":"op","op":"div",
              "left":{"type":"measure","id":"receita"},
              "right":{"type":"literal","value":2}},
            "right":{"type":"literal","value":2}},
          "right":{"type":"literal","value":2}},
        "right":{"type":"literal","value":2}}'::jsonb)$$,
  '22023', NULL,
  'PF2: profundidade 4 é RECUSADA — o caso que a emenda mandou testar explicitamente');

-- ===========================================================================
-- (ER) Falhar alto, nunca em silêncio — obrigação 2
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate('{"type":"measure","id":"nao_existe"}'::jsonb)$$,
  '22023', NULL, 'ER1: medida fora do catálogo é recusada');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate('{"type":"measure","id":"tempo_medio_etapa"}'::jsonb)$$,
  '22023', NULL,
  'ER2: medida que não aceita o recorte total não serve de operando (levantaria 22023 só ao abrir a janela)');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate(
      '{"type":"measure","id":"receita","filters":{"organization_id":"x"}}'::jsonb)$$,
  '22023', NULL,
  'ER3: filtro fora da allowlist é recusado — organization_id NUNCA vem do payload');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate('{"type":"literal","value":"muitos"}'::jsonb)$$,
  '22023', NULL, 'ER4: literal não-numérico é recusado');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate('{"type":"literal","value":1e20}'::jsonb)$$,
  '22023', NULL, 'ER5: literal fora do intervalo é recusado');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate(
      '{"type":"op","op":"div","left":{"type":"measure","id":"receita"}}'::jsonb)$$,
  '22023', NULL, 'ER6: operação sem os dois operandos é recusada');

SELECT throws_ok(
  $$SELECT public.fn_metric_tree_validate('{"type":"formula","expr":"receita/2"}'::jsonb)$$,
  '22023', NULL,
  'ER7: tipo de nó desconhecido é recusado — não existe fórmula em texto para parsear');

-- ===========================================================================
-- Daqui em diante como MEMBRO DE A — o caminho real do navegador
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3914115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (TR) A ARMADILHA DE 100×
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"div","left":{"type":"measure","id":"leads_criados"},"right":{"type":"measure","id":"num_vendas"}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  2.5::numeric,
  'TR1: 5 leads ÷ 2 vendas = 2,5 — e NÃO 250. Se voltar a 250, a armadilha de 100× voltou');

SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"div","left":{"type":"measure","id":"leads_criados"},"right":{"type":"measure","id":"num_vendas"}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'unit'),
  'ratio',
  'TR2: a unidade é ratio, não percent — o motor não tem por onde multiplicar');

-- E quem QUER percentual consegue, escrevendo a multiplicação na composição.
-- A conversão fica visível na árvore em vez de escondida no motor.
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"mul","left":{"type":"op","op":"div","left":{"type":"measure","id":"num_vendas"},"right":{"type":"measure","id":"leads_criados"}},"right":{"type":"literal","value":100}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  40::numeric,
  'TR3: (2 ÷ 5) × 100 = 40 — percentual se escreve na árvore, e sai certo');

-- O contraste que justifica a regra: o MESMO par, pelo ramo `ratio` do v1,
-- devolve 40 porque aquele ramo multiplica. Os dois estão certos — o que não
-- pode é o motor multiplicar sem que a composição peça.
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"num_vendas","den":"leads_criados"}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'unit'),
  'percent',
  'TR4: o ramo ratio do v1 segue derivando percent — a Emenda 1 não o mexeu');

-- ===========================================================================
-- (OP) Um teste por operador — obrigação 3 da emenda
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"add","left":{"type":"measure","id":"leads_criados"},"right":{"type":"measure","id":"num_vendas"}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  7::numeric, 'OP1: + → 5 + 2 = 7');

SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"sub","left":{"type":"measure","id":"leads_criados"},"right":{"type":"measure","id":"num_vendas"}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  3::numeric, 'OP2: − → 5 − 2 = 3');

SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"mul","left":{"type":"measure","id":"leads_criados"},"right":{"type":"literal","value":2}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  10::numeric, 'OP3: × → 5 × 2 = 10');

-- O exemplo do CTO, palavra por palavra: receita ÷ leads.
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"custom","id":"3914de40-0000-4000-8000-000000000001"}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  800.00::numeric,
  'OP4: ÷ → R$ 4.000 ÷ 5 leads = R$ 800 por lead (o exemplo do CTO)');

SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"custom","id":"3914de40-0000-4000-8000-000000000001"}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'unit'),
  'currency',
  'OP5: e a unidade é dinheiro — currency ÷ count → currency');

-- "Por dia útil": medida ÷ literal, o caso que a profundidade 1 não cobria.
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"div","left":{"type":"measure","id":"receita"},"right":{"type":"literal","value":20}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  200.00::numeric,
  'OP6: R$ 4.000 ÷ 20 dias úteis = R$ 200 por dia');

-- ===========================================================================
-- (D0) Denominador zero é AUSÊNCIA, em qualquer nível
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"tree","tree":{"type":"op","op":"div","left":{"type":"measure","id":"receita"},"right":{"type":"literal","value":0}}}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date) -> 'value')::text,
  'null',
  'D01: dividir por zero devolve null — não 0, não erro');

-- Ausência PROPAGA: janela sem venda faz o operando ser null, e o resultado
-- inteiro é null. Zero seria uma afirmação sobre o período, e "não sei" não é zero.
SELECT is(
  (public.fn_metric_measure('39140000-0000-4000-8000-00000000000a',
     '{"kind":"custom","id":"3914de40-0000-4000-8000-000000000001"}'::jsonb,
     'total', 'range', NULL, '2027-09-01'::date, '2027-09-30'::date) -> 'value')::text,
  'null',
  'D02: janela sem dado propaga ausência até a raiz');

-- ===========================================================================
-- (RT) VALIDAÇÃO EM RUNTIME — a segunda ponta
-- ===========================================================================
-- A linha `Metrica legada quebrada` entrou com o trigger DESLIGADO, como uma
-- definição antiga sobreviveria a um aperto de regra. Sem esta checagem, ela
-- viraria número errado em silêncio.
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '39140000-0000-4000-8000-00000000000a',
      '{"kind":"custom","id":"3914de40-0000-4000-8000-0000000000ff"}'::jsonb,
      'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date)$$,
  '22023', NULL,
  'RT1: árvore gravada mas inválida é RECUSADA em runtime — validar só na escrita não bastaria');

SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '39140000-0000-4000-8000-00000000000a',
      '{"kind":"custom","id":"3914de40-0000-4000-8000-0000000000b1"}'::jsonb,
      'total')$$,
  '22023', NULL,
  'RT2: definição de OUTRA org é invisível mesmo com o id em mãos — o filtro usa o org_id do servidor');

SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '39140000-0000-4000-8000-00000000000a',
      '{"kind":"custom"}'::jsonb, 'total')$$,
  '22023', NULL, 'RT3: measure_ref custom sem id é recusado');

-- ===========================================================================
-- (RL) RLS — leitura para a org, escrita para o admin de equipe
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.metric_custom_definitions),
  2::bigint,
  'RL1: membro de A lê as 2 definições de A — e nenhuma da B');

SELECT throws_ok(
  $$INSERT INTO public.metric_custom_definitions (organization_id, name, tree, format_id, derived_unit)
    VALUES ('39140000-0000-4000-8000-00000000000a', 'Tentativa do membro',
            '{"type":"measure","id":"leads_criados"}'::jsonb, 'integer', 'count')$$,
  '42501', NULL,
  'RL2: MEMBRO não cria métrica — definição muda o número que a org inteira lê');

-- ===========================================================================
-- (WR) Validação na ESCRITA — a primeira ponta, com o trigger LIGADO
-- ===========================================================================
RESET role;
SET LOCAL role postgres;
SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3914115e-0000-4000-8000-0000000000ad","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.metric_custom_definitions (id, organization_id, name, tree, format_id)
    VALUES ('3914de40-0000-4000-8000-00000000000c',
            '39140000-0000-4000-8000-00000000000a', 'Ticket por dia util',
            '{"type":"op","op":"div","left":{"type":"measure","id":"receita"},"right":{"type":"literal","value":20}}'::jsonb,
            'currency_brl')$$,
  'WR1: ADMIN cria métrica, e sem mandar derived_unit — o trigger a deriva');

SELECT is(
  (SELECT derived_unit FROM public.metric_custom_definitions
    WHERE id = '3914de40-0000-4000-8000-00000000000c'),
  'currency',
  'WR2: o trigger gravou a unidade DERIVADA — não é campo do cliente');

SELECT throws_ok(
  $$INSERT INTO public.metric_custom_definitions (organization_id, name, tree, format_id)
    VALUES ('39140000-0000-4000-8000-00000000000a', 'Formato incoerente',
            '{"type":"op","op":"div","left":{"type":"measure","id":"receita"},"right":{"type":"literal","value":20}}'::jsonb,
            'percent_1')$$,
  '22023', NULL,
  'WR3: formato incoerente com a unidade derivada é RECUSADO na escrita — a tela mentiria');

SELECT throws_ok(
  $$INSERT INTO public.metric_custom_definitions (organization_id, name, tree, format_id)
    VALUES ('39140000-0000-4000-8000-00000000000a', 'Profundidade quatro',
            '{"type":"op","op":"div",
              "left":{"type":"op","op":"div",
                "left":{"type":"op","op":"div",
                  "left":{"type":"op","op":"div",
                    "left":{"type":"measure","id":"receita"},
                    "right":{"type":"literal","value":2}},
                  "right":{"type":"literal","value":2}},
                "right":{"type":"literal","value":2}},
              "right":{"type":"literal","value":2}}'::jsonb,
            'currency_brl')$$,
  '22023', NULL,
  'WR4: profundidade 4 é recusada TAMBÉM na escrita — as duas pontas, não uma');

SELECT throws_ok(
  $$INSERT INTO public.metric_custom_definitions (organization_id, name, tree, format_id)
    VALUES ('39140000-0000-4000-8000-00000000000b', 'Metrica plantada na org alheia',
            '{"type":"measure","id":"leads_criados"}'::jsonb, 'integer')$$,
  '42501', NULL,
  'WR5: admin de A não planta definição na org B');

SELECT * FROM finish();
ROLLBACK;

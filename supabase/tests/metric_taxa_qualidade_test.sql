-- supabase/tests/metric_taxa_qualidade_test.sql
--
-- SCRUM-311, fatia 7: `taxa_qualidade` — a primeira RAZÃO da série.
--   boas_avaliacoes ÷ leads_avaliados
--
-- O que esta suíte protege, e por que cada bloco existe:
--
--   (CO) COERÊNCIA unidade-derivada × formato-declarado, em TODA linha de
--        `metric_catalog_ratios`. O motor deriva a unidade do par; o front
--        formata pelo `format_id`. Nada liga os dois hoje, e a tabela só tem FK
--        para a lista de formatos. Um preset `duration ÷ count` com formato
--        `percent_1` imprime "0,4%" onde o número é 42% — erro de 100×, mudo.
--        Esta é a asserção que roda em TODO CI, não só no dia do apply.
--   (AN) ÂNCORA compartilhada. A razão herda a âncora do numerador e cala sobre
--        a do denominador. Par com âncoras diferentes divide duas coortes.
--   (VL) o número, e o teto: bons ⊆ avaliados, logo a taxa vive em [0, 100].
--   (D0) denominador vazio é AUSÊNCIA (`value null` + `empty_reason`), nunca 0%.
--   (NZ) numerador vazio é ZERO DE VERDADE — e hoje sai SEM `empty_reason`.
--        Documentado como está: se um dia mudar, este teste avisa.
--   (FT) a razão IGNORA o recorte pedido. O motor força 'total' nos dois filhos
--        e devolve `series: null` sempre.
--   (RG) regressão do catálogo: os três presets fundadores continuam servidos, e
--        `fn_metric_catalog` serve exatamente o que a tabela tem.
--   (XO) isolamento cross-org nas duas metades: autorização e filtro.
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
  ('31180000-0000-4000-8000-00000000000a', 'Org TQ A', 'org-tq-a', 'America/Sao_Paulo'),
  ('31180000-0000-4000-8000-00000000000b', 'Org TQ B', 'org-tq-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- `fn_metric_measure` chama `assert_org_access`, que exige membro ATIVO da org.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3118115e-0000-4000-8000-00000000000a', 'user-3118a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3118115e-0000-4000-8000-00000000000b', 'user-3118b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- 'member', não 'membro': o enum app_role não tem 'membro'.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('31181ea9-0000-4000-8000-00000000000a', '31180000-0000-4000-8000-00000000000a',
   '3118115e-0000-4000-8000-00000000000a', 'Membro TQ A', 'member', true),
  ('31181ea9-0000-4000-8000-00000000000b', '31180000-0000-4000-8000-00000000000b',
   '3118115e-0000-4000-8000-00000000000b', 'Membro TQ B', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- Org A, três janelas com propósitos diferentes:
--
--   AGOSTO/2027   2 diamante + 1 prata (só pré) → bons = 3
--                 1 bronze + 1 desqualificado    → avaliados sobe, bons não
--                 3 sem tier                     → não avaliados
--                 1 apagado                      → fora de tudo
--                 avaliados = 5, bons = 3        → taxa = 60,00%
--
--   SETEMBRO/2027 1 lead cru               → avaliados = 0 → DENOMINADOR VAZIO
--                 (a base NÃO está vazia: é o denominador que está)
--
--   OUTUBRO/2027  1 bronze                 → avaliados = 1, bons = 0 → 0,00%
INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at,
                          deleted_at, qualification_tier, pre_qualification_tier) VALUES
  ('3118ead1-0000-4000-8000-000000000001', '31180000-0000-4000-8000-00000000000a', 'Diamante 1', 'meta_ads',  '2027-08-10T12:00:00Z', '2027-08-10T12:00:00Z', NULL, 'diamante', NULL),
  ('3118ead1-0000-4000-8000-000000000002', '31180000-0000-4000-8000-00000000000a', 'Diamante 2', 'meta_ads',  '2027-08-11T12:00:00Z', '2027-08-11T12:00:00Z', NULL, 'diamante', NULL),
  ('3118ead1-0000-4000-8000-000000000003', '31180000-0000-4000-8000-00000000000a', 'Prata pre',  'indicacao', '2027-08-12T12:00:00Z', '2027-08-12T12:00:00Z', NULL, NULL, 'prata'),
  ('3118ead1-0000-4000-8000-000000000004', '31180000-0000-4000-8000-00000000000a', 'Bronze ago', 'meta_ads',  '2027-08-13T12:00:00Z', '2027-08-13T12:00:00Z', NULL, 'bronze', NULL),
  ('3118ead1-0000-4000-8000-000000000005', '31180000-0000-4000-8000-00000000000a', 'Desqual',    'indicacao', '2027-08-14T12:00:00Z', '2027-08-14T12:00:00Z', NULL, 'desqualificado', NULL),
  ('3118ead1-0000-4000-8000-000000000006', '31180000-0000-4000-8000-00000000000a', 'Cru 1',      'meta_ads',  '2027-08-15T12:00:00Z', '2027-08-15T12:00:00Z', NULL, NULL, NULL),
  ('3118ead1-0000-4000-8000-000000000007', '31180000-0000-4000-8000-00000000000a', 'Cru 2',      'meta_ads',  '2027-08-16T12:00:00Z', '2027-08-16T12:00:00Z', NULL, NULL, NULL),
  ('3118ead1-0000-4000-8000-000000000008', '31180000-0000-4000-8000-00000000000a', 'Cru 3',      'indicacao', '2027-08-17T12:00:00Z', '2027-08-17T12:00:00Z', NULL, NULL, NULL),
  ('3118ead1-0000-4000-8000-000000000009', '31180000-0000-4000-8000-00000000000a', 'Apagado',    'meta_ads',  '2027-08-18T12:00:00Z', '2027-08-18T12:00:00Z', now(), 'ouro', NULL),
  ('3118ead1-0000-4000-8000-000000000010', '31180000-0000-4000-8000-00000000000a', 'Cru set',    'meta_ads',  '2027-09-10T12:00:00Z', '2027-09-10T12:00:00Z', NULL, NULL, NULL),
  ('3118ead1-0000-4000-8000-000000000011', '31180000-0000-4000-8000-00000000000a', 'Bronze out', 'meta_ads',  '2027-10-10T12:00:00Z', '2027-10-10T12:00:00Z', NULL, 'bronze', NULL)
ON CONFLICT (id) DO NOTHING;

-- Org B: 1 ouro. Existe para provar que a taxa da A não a enxerga, e vice-versa.
INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at,
                          deleted_at, qualification_tier, pre_qualification_tier) VALUES
  ('3118ead1-0000-4000-8000-0000000000b1', '31180000-0000-4000-8000-00000000000b', 'Ouro B', 'meta_ads', '2027-08-10T12:00:00Z', '2027-08-10T12:00:00Z', NULL, 'ouro', NULL)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) O preset no catálogo
-- ===========================================================================
SELECT is(
  (SELECT num_measure_id || ' / ' || den_measure_id || ' / ' || format_id
     FROM public.metric_catalog_ratios WHERE id = 'taxa_qualidade'),
  'boas_avaliacoes / leads_avaliados / percent_1',
  'CT1: o preset é boas_avaliacoes ÷ leads_avaliados, formatado como percentual');

SELECT is(
  (SELECT r->>'unit' FROM jsonb_array_elements(public.fn_metric_catalog()->'ratios') r
    WHERE r->>'id' = 'taxa_qualidade'),
  'percent',
  'CT2: a descoberta anuncia percent — a mesma unidade que o motor vai derivar');

-- ===========================================================================
-- (CO) Coerência unidade-derivada × formato-declarado — TODAS as linhas
-- ===========================================================================
-- A regra transcrita do motor. Uma linha fora dela não quebra nada: ela mente
-- na tela, em silêncio, por um fator de 100.
SELECT is(
  (SELECT count(*)::int
     FROM public.metric_catalog_ratios r
     JOIN public.metric_catalog_measures mn ON mn.id = r.num_measure_id
     JOIN public.metric_catalog_measures md ON md.id = r.den_measure_id
    WHERE r.format_id <> CASE
            WHEN mn.unit = 'count'    AND md.unit = 'count' THEN 'percent_1'
            WHEN mn.unit = 'currency' AND md.unit = 'count' THEN 'currency_brl'
            ELSE 'ratio_2' END),
  0,
  'CO1: nenhum preset de razão declara formato incompatível com a unidade derivada');

-- ===========================================================================
-- (AN) Âncora compartilhada
-- ===========================================================================
SELECT is(
  (SELECT count(DISTINCT m.anchor)::int FROM public.metric_catalog_measures m
    WHERE m.id IN ('boas_avaliacoes', 'leads_avaliados')),
  1,
  'AN1: numerador e denominador ancoram igual — a razão não cruza duas coortes');

-- ===========================================================================
-- Daqui em diante como MEMBRO DE A — o caminho real do navegador
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3118115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (VL) O número
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  60.00::numeric, 'VL1: 3 bons de 5 avaliados = 60,00%');

SELECT is(
  public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) ->> 'unit',
  'percent', 'VL2: count ÷ count deriva percent — o valor já vem multiplicado por 100');

-- O teto não é convenção, é consequência: bons é subconjunto de avaliados.
SELECT ok(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric BETWEEN 0 AND 100,
  'VL3: a taxa vive em [0, 100] por construção — bons ⊆ avaliados');

-- Os dois filhos aparecem no payload com o próprio número, para a UI explicar
-- de onde a taxa saiu sem uma terceira consulta.
SELECT is(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) -> 'num' ->> 'value')::numeric
  || ' de ' ||
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) -> 'den' ->> 'value')::numeric,
  '3 de 5', 'VL4: o payload carrega os dois filhos — 3 de 5');

-- ===========================================================================
-- (D0) Denominador vazio é ausência, não 0%
-- ===========================================================================
SELECT is(
  public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
    '2027-09-01'::date, '2027-09-30'::date) -> 'value',
  'null'::jsonb,
  'D01: setembro tem lead mas nenhum avaliado → value null (não 0, não erro)');

SELECT is(
  public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
    '2027-09-01'::date, '2027-09-30'::date) ->> 'empty_reason',
  'no_rows',
  'D02: e diz por quê — a tela mostra travessão, não zero');

-- ===========================================================================
-- (NZ) Numerador vazio é zero de verdade
-- ===========================================================================
-- Outubro tem 1 avaliado e 0 bons. "Ninguém foi aprovado" é informação; virar
-- travessão a esconderia. Hoje o motor só olha o denominador para decidir
-- ausência — este teste fixa esse comportamento por escrito.
SELECT is(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-10-01'::date, '2027-10-31'::date) ->> 'value')::numeric,
  0::numeric, 'NZ1: 0 bons de 1 avaliado = 0,00% — e é um número, não uma ausência');

SELECT ok(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-10-01'::date, '2027-10-31'::date) ->> 'empty_reason') IS NULL,
  'NZ2: numerador vazio NÃO gera empty_reason — o motor só olha o denominador');

-- ===========================================================================
-- (FT) A razão ignora o recorte pedido
-- ===========================================================================
SELECT is(
  public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'origem', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'series',
  'null'::jsonb, 'FT1: razão devolve series null mesmo com recorte pedido');

SELECT is(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'origem', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  60.00::numeric, 'FT2: e o valor é o mesmo do total — o motor força total nos dois filhos');

-- ===========================================================================
-- (RG) Regressão do catálogo
-- ===========================================================================
-- Esta fatia ESCREVE no catálogo. O risco dela não é cálculo: é apagar ou
-- deslocar o que já estava servido.
SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_ratios
    WHERE id IN ('conversao', 'comparecimento', 'ticket_medio')),
  3, 'RG1: os três presets fundadores continuam no catálogo');

SELECT is(
  (SELECT count(*)::int FROM (SELECT jsonb_array_elements(public.fn_metric_catalog()->'ratios')) x),
  (SELECT count(*)::int FROM public.metric_catalog_ratios),
  'RG2: fn_metric_catalog serve exatamente as razões registradas, nem uma a mais nem a menos');

SELECT is(
  public.fn_metric_measure('31180000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"receita","den":"num_vendas"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) ->> 'unit',
  'currency', 'RG3: o caminho da receita (ticket médio) segue derivando currency');

-- ===========================================================================
-- (XO) Isolamento cross-org, as duas metades
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31180000-0000-4000-8000-00000000000b',
      '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date)$$,
  'P0001', NULL,
  'XO1: membro de A é BLOQUEADO na org B (assert_org_access)');

SELECT set_config('request.jwt.claims',
  '{"sub":"3118115e-0000-4000-8000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (public.fn_metric_measure('31180000-0000-4000-8000-00000000000b',
     '{"kind":"ratio","num":"boas_avaliacoes","den":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  100.00::numeric, 'XO2: org B calcula só o próprio — 1 ouro de 1 avaliado = 100%');

SELECT * FROM finish();
ROLLBACK;

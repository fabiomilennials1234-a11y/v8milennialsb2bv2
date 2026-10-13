-- supabase/tests/abrir_negocio_adota_card_sem_negocio_test.sql
--
-- Negócio duplicado (Chique Distribuidora, 13/10): o lead entrou pelo site com
-- card SEM negócio; dois minutos depois POST /deals criou OUTRO card no mesmo
-- funil. `abrir_negocio` agora adota o card sem negócio do mesmo lead/funil.
--
-- O que este arquivo trava:
--   (ADOTA)     card aberto sem negócio vira o card do negócio — um card só;
--   (POSIÇÃO)   o card adotado não muda de etapa;
--   (PREENCHE)  notas pedidas preenchem só o que está vazio;
--   (RECOMPRA)  card que JÁ tem negócio não é adotado — segundo negócio cria card;
--   (ESCOPO)    card fechado, ou de outro funil, não é adotado;
--   (ORDEM)     com dois órfãos, o mais antigo é adotado;
--   (CUSTOM)    funciona em funil personalizado, e uuid de etapa de outro funil
--               continua sendo recusado mesmo quando há card para adotar.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000ad01', 'Org Adota', 'org-adota', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-00000000a101', 'deadbeef-0000-4000-8000-00000000ad01', 'Gisele (órfão no funil)'),
  ('deadbeef-0000-4000-8000-00000000a102', 'deadbeef-0000-4000-8000-00000000ad01', 'Órfão fechado'),
  ('deadbeef-0000-4000-8000-00000000a103', 'deadbeef-0000-4000-8000-00000000ad01', 'Órfão em outro funil'),
  ('deadbeef-0000-4000-8000-00000000a104', 'deadbeef-0000-4000-8000-00000000ad01', 'Órfão custom'),
  ('deadbeef-0000-4000-8000-00000000a105', 'deadbeef-0000-4000-8000-00000000ad01', 'Dois órfãos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ad01', 'Oportunidades', 'whatsapp',    'system'),
  ('deadbeef-0000-4000-8000-00000000ab02', 'deadbeef-0000-4000-8000-00000000ad01', 'Prospecção',    'prospeccao',  'custom'),
  ('deadbeef-0000-4000-8000-00000000ab03', 'deadbeef-0000-4000-8000-00000000ad01', 'Outro custom',  'outro-custom','custom')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active)
VALUES
  ('deadbeef-0000-4000-8000-00000000ac01', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab01', 'whatsapp', 'novo_lead', 'Novo Lead', 0, true),
  ('deadbeef-0000-4000-8000-00000000ac02', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab01', 'whatsapp', 'disparo_enviado', 'Disparo Enviado', 1, true),
  ('deadbeef-0000-4000-8000-00000000ac03', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab02', NULL, 'entrada', 'Entrada', 0, true),
  ('deadbeef-0000-4000-8000-00000000ac04', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab02', NULL, 'contato', 'Contato', 1, true),
  ('deadbeef-0000-4000-8000-00000000ac05', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab03', NULL, 'alheia', 'Alheia', 0, true)
ON CONFLICT (id) DO NOTHING;

-- Cards SEM negócio: o estado que o lead tem depois de entrar pelo site.
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_id, stage_key, notes, closed_at, created_at)
VALUES
  -- Gisele: já andou para Disparo Enviado e tem nota própria.
  ('deadbeef-0000-4000-8000-00000000ae01', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000a101',
   'deadbeef-0000-4000-8000-00000000ac02', 'disparo_enviado', 'nota do card', NULL, now() - interval '2 min'),
  -- Fechado: não é posição viva.
  ('deadbeef-0000-4000-8000-00000000ae02', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000a102',
   'deadbeef-0000-4000-8000-00000000ac01', 'novo_lead', NULL, now() - interval '1 day', now() - interval '2 days'),
  -- Outro funil: o negócio será aberto em Oportunidades.
  ('deadbeef-0000-4000-8000-00000000ae03', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab02', 'deadbeef-0000-4000-8000-00000000a103',
   'deadbeef-0000-4000-8000-00000000ac03', 'entrada', NULL, NULL, now() - interval '2 min'),
  -- Custom: em Contato, sem nota.
  ('deadbeef-0000-4000-8000-00000000ae04', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab02', 'deadbeef-0000-4000-8000-00000000a104',
   'deadbeef-0000-4000-8000-00000000ac04', 'contato', NULL, NULL, now() - interval '2 min'),
  -- Dois órfãos: o mais antigo é o adotado.
  ('deadbeef-0000-4000-8000-00000000ae05', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000a105',
   'deadbeef-0000-4000-8000-00000000ac01', 'novo_lead', NULL, NULL, now() - interval '1 hour'),
  ('deadbeef-0000-4000-8000-00000000ae06', 'deadbeef-0000-4000-8000-00000000ad01',
   'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000a105',
   'deadbeef-0000-4000-8000-00000000ac01', 'novo_lead', NULL, NULL, now() - interval '5 min');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (ADOTA) o caso da Gisele: POST /deals com card sem negócio no funil
-- ===========================================================================
CREATE TEMP TABLE r1 AS
SELECT public.api_create_deal(
  'deadbeef-0000-4000-8000-00000000ad01',
  'deadbeef-0000-4000-8000-00000000a101',
  'whatsapp', 'novo_lead', NULL, NULL, 'Gi Feiten perfumaria', 'nota da api', 'api', 'adota-1') AS j;

SELECT is((SELECT j->>'status' FROM r1), 'created', '(ADOTA) o negócio é criado');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-00000000a101'
      AND pipeline_id = 'deadbeef-0000-4000-8000-00000000ab01'
      AND closed_at IS NULL),
  1::bigint,
  '(ADOTA) continua UM card do lead no funil — era o card duplicado do Chamado');

SELECT is(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae01'),
  ((SELECT j->'deal'->>'id' FROM r1))::uuid,
  '(ADOTA) o negócio ficou ligado ao card que JÁ existia');

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae01'),
  'disparo_enviado',
  '(POSIÇÃO) o card adotado fica onde estava — mover reabriria as automações de entrada');

SELECT is(
  (SELECT notes FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae01'),
  'nota do card',
  '(PREENCHE) nota que o card já tinha NÃO é sobrescrita');

-- ===========================================================================
-- (RECOMPRA) card que já tem negócio não é adotado
-- ===========================================================================
CREATE TEMP TABLE r2 AS
SELECT public.api_create_deal(
  'deadbeef-0000-4000-8000-00000000ad01',
  'deadbeef-0000-4000-8000-00000000a101',
  'whatsapp', 'novo_lead', NULL, NULL, 'Recompra', NULL, 'api', 'adota-2') AS j;

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-00000000a101'
      AND pipeline_id = 'deadbeef-0000-4000-8000-00000000ab01'
      AND closed_at IS NULL),
  2::bigint,
  '(RECOMPRA) segundo negócio cria card próprio — ADR-0023 decisão 2 intacta');

SELECT is(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae01'),
  ((SELECT j->'deal'->>'id' FROM r1))::uuid,
  '(RECOMPRA) o card do primeiro negócio não foi religado ao segundo');

-- ===========================================================================
-- (ESCOPO) card fechado e card de outro funil ficam como estão
-- ===========================================================================
SELECT public.abrir_negocio(
  'deadbeef-0000-4000-8000-00000000a102', 'whatsapp', 'novo_lead',
  p_source => 'api');

SELECT ok(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae02') IS NULL,
  '(ESCOPO) card FECHADO sem negócio não é adotado');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-00000000a102' AND deal_id IS NOT NULL AND closed_at IS NULL),
  1::bigint,
  '(ESCOPO) com o órfão fechado, o negócio nasce em card novo');

SELECT public.abrir_negocio(
  'deadbeef-0000-4000-8000-00000000a103', 'whatsapp', 'novo_lead',
  p_source => 'api');

SELECT ok(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae03') IS NULL,
  '(ESCOPO) card sem negócio de OUTRO funil não é adotado');

-- ===========================================================================
-- (ORDEM) dois órfãos no funil: o mais antigo
-- ===========================================================================
CREATE TEMP TABLE r5 AS
SELECT public.abrir_negocio(
  'deadbeef-0000-4000-8000-00000000a105', 'whatsapp', 'novo_lead',
  p_source => 'api') AS deal_id;

SELECT is(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae05'),
  (SELECT deal_id FROM r5),
  '(ORDEM) o órfão MAIS ANTIGO recebe o negócio');

SELECT ok(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae06') IS NULL,
  '(ORDEM) o outro órfão segue sem negócio — um negócio, um card');

-- ===========================================================================
-- (CUSTOM) funil personalizado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public.abrir_negocio(
       'deadbeef-0000-4000-8000-00000000a104', 'deadbeef-0000-4000-8000-00000000ab02',
       'deadbeef-0000-4000-8000-00000000ac05', p_source => 'api') $$,
  '22023', NULL,
  '(CUSTOM) uuid de etapa de OUTRO funil é recusado mesmo havendo card para adotar');

SELECT ok(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae04') IS NULL,
  '(CUSTOM) a recusa não deixou o card ligado a nada');

CREATE TEMP TABLE r4 AS
SELECT public.abrir_negocio(
  'deadbeef-0000-4000-8000-00000000a104', 'deadbeef-0000-4000-8000-00000000ab02',
  'entrada', p_notes => 'nota da api', p_source => 'api') AS deal_id;

SELECT is(
  (SELECT deal_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae04'),
  (SELECT deal_id FROM r4),
  '(CUSTOM) o card sem negócio do funil personalizado é adotado');

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae04'),
  'contato',
  '(CUSTOM) e fica na etapa em que estava');

SELECT is(
  (SELECT notes FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000ae04'),
  'nota da api',
  '(PREENCHE) card sem nota recebe a nota pedida');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-00000000a104' AND closed_at IS NULL),
  1::bigint,
  '(CUSTOM) um card só');

SELECT * FROM finish();
ROLLBACK;

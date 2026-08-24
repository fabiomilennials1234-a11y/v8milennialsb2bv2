-- supabase/tests/auto_seed_card_morto_test.sql
--
-- Ticket #1775 — inserir um Lead NÃO cria mais posição em funil.
--
-- O gatilho que morreu, `trg_auto_assign_lead_default_pipe`, era um CONSTRAINT
-- TRIGGER DEFERRABLE INITIALLY DEFERRED: ele rodava no COMMIT, não no INSERT.
-- Dentro de uma suíte que roda em transação revertida isso é uma armadilha —
-- um teste ingênuo insere o Lead, não vê card nenhum e passa VERDE mesmo com o
-- gatilho vivo, porque o COMMIT nunca chega. Por isso cada caso aqui força
-- `SET CONSTRAINTS ALL IMMEDIATE`, que dispara o gatilho diferido na hora.
--
-- E por isso existe o CONTROLE POSITIVO no fim: ele recria o gatilho dentro da
-- transação e prova que, com ele de pé, o card NASCE — e que portanto as
-- asserções acima medem a ausência do gatilho, não a ausência de COMMIT.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- (STRUCT) o gatilho não existe mais em `leads`
-- ===========================================================================
SELECT is_empty(
  $$ SELECT t.tgname FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'leads' AND NOT t.tgisinternal
       AND t.tgname = 'trg_auto_assign_lead_default_pipe' $$,
  '(STRUCT) trg_auto_assign_lead_default_pipe não existe mais em leads (#1775)');

-- A função fica — é a documentação do auto-seed e o caminho do rollback.
SELECT has_function(
  'public', 'fn_auto_assign_lead_default_pipe',
  '(STRUCT) a função permanece, fora de circulação — o rollback depende dela');

-- Nenhum outro gatilho passou a chamá-la.
SELECT is_empty(
  $$ SELECT t.tgname FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND p.proname = 'fn_auto_assign_lead_default_pipe' $$,
  '(STRUCT) nenhum gatilho chama fn_auto_assign_lead_default_pipe');

-- ===========================================================================
-- Fixture: org com funil system whatsapp ativo e etapa ativa — exatamente o
-- cenário em que o auto-seed semeava. Sem isso, "não nasceu card" não provaria
-- nada: poderia ser falta de funil.
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('deadbeef-1775-4000-8000-00000000c001', 'Org auto-seed morto', 'org-auto-seed-morto', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active)
VALUES ('deadbeef-1775-4000-8000-00000000c002', 'deadbeef-1775-4000-8000-00000000c001',
        'WhatsApp', 'whatsapp', 'system', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
VALUES ('deadbeef-1775-4000-8000-00000000c001', 'whatsapp', 'novo', 'Novo Lead', 1, true)
ON CONFLICT DO NOTHING;

-- Prova que a fixture é o cenário certo, e não um cenário vazio que passaria
-- por acidente.
SELECT isnt_empty(
  $$ SELECT 1 FROM public.pipelines
     WHERE organization_id = 'deadbeef-1775-4000-8000-00000000c001'
       AND slug = 'whatsapp' AND type = 'system' AND is_active $$,
  '(FIXTURE) a org tem funil system whatsapp ativo — o cenário do auto-seed');

-- ===========================================================================
-- (COMPORTAMENTO) inserir Lead não cria posição em funil
-- ===========================================================================
INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-1775-4000-8000-00000000c003', 'deadbeef-1775-4000-8000-00000000c001', 'Lead sem card');

-- Dispara o que estiver diferido. Sem esta linha o teste passaria verde mesmo
-- com o gatilho de pé.
SET CONSTRAINTS ALL IMMEDIATE;

SELECT is_empty(
  $$ SELECT id FROM public.pipeline_entries
     WHERE lead_id = 'deadbeef-1775-4000-8000-00000000c003' $$,
  '(COMPORTAMENTO) Lead inserido não gerou linha em pipeline_entries');

SELECT is_empty(
  $$ SELECT id FROM public.custom_pipe_entries
     WHERE lead_id = 'deadbeef-1775-4000-8000-00000000c003' $$,
  '(COMPORTAMENTO) nem em custom_pipe_entries');

-- Sem card, sem Negócio — e o Lead continua na base, que é o ponto do ADR-0030.
SELECT is_empty(
  $$ SELECT id FROM public.deals
     WHERE source_lead_id = 'deadbeef-1775-4000-8000-00000000c003' $$,
  '(COMPORTAMENTO) nenhum Negócio nasceu junto');

SELECT isnt_empty(
  $$ SELECT id FROM public.leads
     WHERE id = 'deadbeef-1775-4000-8000-00000000c003' $$,
  '(COMPORTAMENTO) o Lead ESTÁ na base — o corte não rejeita ingestão');

-- ===========================================================================
-- (CONTROLE POSITIVO) com o gatilho de volta, o card nasce
--
-- Prova que o cenário acima é capaz de produzir card, e que as asserções
-- mediram a morte do gatilho — não um COMMIT que nunca veio nem uma fixture
-- incompleta. Se este caso falhar, os de cima são verde por ausência.
-- ===========================================================================
CREATE CONSTRAINT TRIGGER trg_auto_assign_lead_default_pipe_controle
  AFTER INSERT ON public.leads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_assign_lead_default_pipe();

INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-1775-4000-8000-00000000c004', 'deadbeef-1775-4000-8000-00000000c001', 'Lead do controle');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT isnt_empty(
  $$ SELECT id FROM public.pipeline_entries
     WHERE lead_id = 'deadbeef-1775-4000-8000-00000000c004' $$,
  '(CONTROLE POSITIVO) com o gatilho recriado o card NASCE — a fixture serve e o diferido dispara');

DROP TRIGGER trg_auto_assign_lead_default_pipe_controle ON public.leads;

SELECT * FROM finish();
ROLLBACK;

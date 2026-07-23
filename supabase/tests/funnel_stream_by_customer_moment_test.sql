-- supabase/tests/funnel_stream_by_customer_moment_test.sql
--
-- ISSUE #1203 — produtor de funil etiqueta revenue_stream pelo momento do cliente.
--
-- Prova:
--   (a) FLAG OFF: o funil mantém a etiqueta antiga (é cliente de Carteira ativo)
--   (b) FLAG ON + ordem que hoje etiqueta errado: cliente de Carteira existe
--       ANTES da primeira venda de funil → com a regra antiga sairia 'carteira';
--       com a nova sai 'novo_negocio' (é PRIMEIRA compra)
--   (c) FLAG ON + recompra real: segunda venda de funil do mesmo lead → 'carteira'
--   (d) uma regra, dois produtores: o rótulo do funil bate com metric_revenue_stream
--   (e) filtros Funil/Carteira/Total: Total soma sem inflar, com 1ª compra e recompra
--
-- Roda inteiro dentro de transação revertida.
--
-- MECÂNICA: o gatilho fn_capture_sale_event dispara em INSERT de
-- pipeline_stage_events com to_stage_key de papel 'won'. As fixtures montam o
-- mínimo para o gatilho rodar de verdade — é teste do PRODUTOR, não injeção
-- direta em sale_events.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

-- ---------------------------------------------------------------------------
-- (setup) org, pipeline com etapa 'won', 2 leads, e um cliente de Carteira
-- criado ANTES de qualquer venda — a ordem que hoje etiqueta errado.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('12031203-aaaa-0000-0000-000000001203', 'Org (#1203)', 'org-1203-fsm', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('12031203-1111-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203', 'Lead primeira'),
  ('12031203-2222-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203', 'Lead flag-off'),
  ('12031203-3333-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203', 'Lead recompra')
ON CONFLICT (id) DO NOTHING;

-- Cliente de Carteira ativo para os DOIS leads. É isto que a expressão antiga
-- lê como 'carteira' — mesmo na PRIMEIRA venda.
INSERT INTO public.upsell_clients (id, organization_id, lead_id, name, is_active) VALUES
  ('12031203-c111-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203',
   '12031203-1111-0000-0000-000000001203', 'Cliente recompra', true),
  ('12031203-c222-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203',
   '12031203-2222-0000-0000-000000001203', 'Cliente flag-off', true),
  ('12031203-c333-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203',
   '12031203-3333-0000-0000-000000001203', 'Cliente recompra', true)
ON CONFLICT (id) DO NOTHING;

-- Venda ANTERIOR do lead recompra, em janeiro (bypass do gatilho, sold_at no
-- passado). É a "primeira compra" histórica. A venda de funil que o gatilho vai
-- emitir para este lead terá sold_at = now() > janeiro, então metric_revenue_stream
-- a vê como anterior. Isto contorna o now()-constante-na-transação: dentro de uma
-- só transação, todas as emissões do gatilho compartilham o mesmo now(), então a
-- única forma de ter uma anterior ESTRITA é semeá-la no passado.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at, sale_value, currency, revenue_stream, source)
VALUES
  ('12031203-aaaa-0000-0000-000000001203', '12031203-3333-0000-0000-000000001203',
   '12031203-9111-0000-0000-000000001203', 'ganho', 'sale',
   '2026-01-05 10:00:00-03', 1000, 'BRL', 'novo_negocio', 'backfill')
ON CONFLICT DO NOTHING;

-- Pipeline type='custom' em `pipelines` (metric_stage_role resolve via ela) +
-- etapa 'won' em custom_pipeline_stages (FK aponta para pipelines.id).
INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('12031203-9111-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203', 'Pipe 1203', 'pipe-1203', 'custom')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_pipeline_stages (id, organization_id, pipeline_id, stage_key, name, position, stage_role) VALUES
  ('12031203-9222-0000-0000-000000001203', '12031203-aaaa-0000-0000-000000001203', '12031203-9111-0000-0000-000000001203', 'ganho', 'Ganho', 1, 'won')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- pipeline_entries tem um gatilho (trg_pipeline_entries_stage_event_insert) que
-- AUTO-CRIA um pipeline_stage_event ao inserir o entry — o que dispararia
-- fn_capture_sale_event uma vez a mais e duplicaria a venda no teste. Desligamos
-- só ele: queremos que APENAS o pipeline_stage_event que o helper insere
-- explicitamente dispare o produtor. Uma emissão controlada por caso.
ALTER TABLE public.pipeline_entries DISABLE TRIGGER trg_pipeline_entries_stage_event_insert;

-- Helper: emite uma venda de funil para um lead, disparando o gatilho REAL, e
-- devolve o revenue_stream gravado. Cria pipeline_entry + pipeline_stage_event.
CREATE OR REPLACE FUNCTION pg_temp.emit_funnel_sale(
  p_lead uuid, p_stage_event_id uuid, p_when timestamptz
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_entry uuid; v_stream text;
BEGIN
  -- Reusa o entry por (pipeline, lead) — há UNIQUE nessas colunas. Um lead que
  -- recompra passa pela MESMA entry várias vezes; é o pipeline_stage_event novo
  -- que dispara o gatilho a cada 'ganho'.
  SELECT id INTO v_entry FROM public.pipeline_entries
  WHERE pipeline_id='12031203-9111-0000-0000-000000001203' AND lead_id=p_lead;
  IF v_entry IS NULL THEN
    v_entry := gen_random_uuid();
    INSERT INTO public.pipeline_entries (id, organization_id, lead_id, pipeline_id, stage_key, metadata)
    VALUES (v_entry, '12031203-aaaa-0000-0000-000000001203', p_lead,
            '12031203-9111-0000-0000-000000001203', 'ganho',
            jsonb_build_object('sale_value', '1000'));
  END IF;

  INSERT INTO public.pipeline_stage_events
    (id, organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key, occurred_at)
  VALUES (p_stage_event_id, '12031203-aaaa-0000-0000-000000001203', p_lead,
          '12031203-9111-0000-0000-000000001203', v_entry, 'novo', 'ganho', p_when);

  SELECT revenue_stream INTO v_stream FROM public.sale_events
  WHERE stage_event_id = p_stage_event_id AND event_type = 'sale';
  RETURN v_stream;
END $$;

-- ---------------------------------------------------------------------------
-- (a) FLAG OFF — comportamento antigo preservado
-- ---------------------------------------------------------------------------
-- Flag desligada (default). Lead flag-off tem cliente de Carteira ativo e
-- nenhuma venda anterior. A expressão antiga vê o cliente ativo → 'carteira'.
SELECT is(
  pg_temp.emit_funnel_sale('12031203-2222-0000-0000-000000001203',
    '12031203-e0ff-0000-0000-000000001203', '2026-03-01 10:00:00-03'),
  'carteira',
  '(a) FLAG OFF: primeira venda com cliente de Carteira ativo → carteira (comportamento antigo)');

-- ---------------------------------------------------------------------------
-- (b) FLAG ON — a ordem que hoje etiqueta errado
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
UPDATE public.organizations SET carteira_emits_revenue_enabled = true
WHERE id = '12031203-aaaa-0000-0000-000000001203';
SET LOCAL role postgres;  -- segue como postgres; o gatilho é SECURITY DEFINER

-- Primeira venda do lead recompra. Cliente de Carteira existe (criado antes),
-- MAS não há venda anterior no livro → regra nova diz PRIMEIRA compra.
SELECT is(
  pg_temp.emit_funnel_sale('12031203-1111-0000-0000-000000001203',
    '12031203-e001-0000-0000-000000001203', '2026-03-10 10:00:00-03'),
  'novo_negocio',
  '(b) FLAG ON: primeira venda apesar de cliente de Carteira ativo → novo_negocio');

-- ---------------------------------------------------------------------------
-- (c) FLAG ON — recompra real
-- ---------------------------------------------------------------------------
SELECT is(
  pg_temp.emit_funnel_sale('12031203-3333-0000-0000-000000001203',
    '12031203-e002-0000-0000-000000001203', '2026-05-20 10:00:00-03'),
  'carteira',
  '(c) FLAG ON: venda com compra anterior no livro → carteira (recompra real)');

-- ---------------------------------------------------------------------------
-- (d) uma regra, dois produtores
-- ---------------------------------------------------------------------------
-- O rótulo que o funil gravou tem que ser o mesmo que metric_revenue_stream
-- responderia para a mesma âncora — provando que é a MESMA regra.
SELECT is(
  (SELECT revenue_stream FROM public.sale_events WHERE stage_event_id='12031203-e002-0000-0000-000000001203'),
  public.metric_revenue_stream('12031203-aaaa-0000-0000-000000001203',
    '12031203-3333-0000-0000-000000001203',
    (SELECT sold_at FROM public.sale_events WHERE stage_event_id='12031203-e002-0000-0000-000000001203'),
    (SELECT id FROM public.sale_events WHERE stage_event_id='12031203-e002-0000-0000-000000001203')),
  '(d) o rótulo do funil == metric_revenue_stream: uma regra, dois produtores');

-- ---------------------------------------------------------------------------
-- (e) Filtros Funil / Carteira / Total — soma sem inflar
-- ---------------------------------------------------------------------------
-- Estado vivo: e0ff (flag-off, carteira) + e001 (lead primeira, novo) +
-- semente de janeiro (lead recompra, novo) + e002 (recompra, carteira).
-- 4 vendas: 2 novo, 2 carteira.
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE organization_id='12031203-aaaa-0000-0000-000000001203' AND event_type='sale'),
  4,
  '(e) quatro vendas vivas no total');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE organization_id='12031203-aaaa-0000-0000-000000001203' AND event_type='sale'
      AND revenue_stream='novo_negocio'),
  2,
  '(e) 2 novo_negocio (a primeira do lead primeira + a semente de janeiro)');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE organization_id='12031203-aaaa-0000-0000-000000001203' AND event_type='sale'
      AND revenue_stream='carteira'),
  2,
  '(e) 2 carteira (a recompra + a flag-off antiga)');

-- Total = Funil-novo + Funil-carteira, sem sobreposição, sem inflar.
SELECT is(
  (SELECT count(*) FILTER (WHERE revenue_stream='novo_negocio')
        + count(*) FILTER (WHERE revenue_stream='carteira')
     FROM public.sale_events
    WHERE organization_id='12031203-aaaa-0000-0000-000000001203' AND event_type='sale')::int,
  4,
  '(e) novo + carteira == total: soma sem inflar');

-- ---------------------------------------------------------------------------
-- (f) A prova de que a mudança é load-bearing: sob a definição ANTIGA, o caso
-- (b) daria 'carteira'. Replanta o corpo antigo e confirma.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;

-- Remove as vendas do lead recompra para reemitir sob a definição antiga.
ALTER TABLE public.sale_events DISABLE TRIGGER trg_sale_events_immutable;
DELETE FROM public.sale_events WHERE organization_id='12031203-aaaa-0000-0000-000000001203'
  AND lead_id='12031203-1111-0000-0000-000000001203';
ALTER TABLE public.sale_events ENABLE TRIGGER trg_sale_events_immutable;

-- Definição ANTIGA (só a parte de v_stream importa; corpo mínimo que reproduz).
CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $planted$
DECLARE v_to_role public.stage_role; v_stream text; v_meta jsonb; v_val numeric;
BEGIN
  v_to_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);
  IF v_to_role = 'won' THEN
    SELECT pe.metadata INTO v_meta FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;
    v_val := NULLIF(v_meta->>'sale_value','')::numeric;
    v_stream := CASE WHEN EXISTS (SELECT 1 FROM public.upsell_clients uc
        WHERE uc.organization_id=NEW.organization_id AND uc.lead_id=NEW.lead_id AND uc.is_active)
      THEN 'carteira' ELSE 'novo_negocio' END;
    INSERT INTO public.sale_events
      (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, sold_at, sale_value, currency, revenue_stream, source)
    VALUES (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id, 'sale', now(), v_val, 'BRL', v_stream, 'trigger');
  END IF;
  RETURN NEW;
END $planted$;

SELECT is(
  pg_temp.emit_funnel_sale('12031203-1111-0000-0000-000000001203',
    '12031203-e0d1-0000-0000-000000001203', '2026-03-10 10:00:00-03'),
  'carteira',
  '(f) PLANTED: sob a definição ANTIGA a primeira venda sairia carteira — a mudança é load-bearing');

SELECT * FROM finish();

ROLLBACK;

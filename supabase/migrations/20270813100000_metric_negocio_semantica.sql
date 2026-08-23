-- 20270813100000_metric_negocio_semantica.sql
--
-- SCRUM-311, fatia 9 de 19: as métricas passam a saber que LEAD ≠ NEGÓCIO.
--
-- POR QUE ISTO NÃO É FASE POSTERIOR
--
-- O ADR-0023 (`negocio-is-the-funnel-unit`, aceito 01/08) inverteu a unidade do
-- funil: quem ocupa etapa é o NEGÓCIO, não o Lead, e um Lead pode ter vários —
-- inclusive dois abertos no mesmo funil. Se o motor de métricas migrar depois,
-- o dia da virada troca o número que o cliente usa para decidir, sem aviso.
--
-- E JÁ NÃO BATE HOJE. Medido em produção, 2026-08-12:
--
--     41.025  entradas de funil abertas   ← o que a medida DEVOLVE
--     36.073  leads distintos nelas       ← o que o nome PROMETE
--      4.952  de diferença                ← ninguém vê
--
-- A medida `leads_na_etapa` conta ENTRADAS; o catálogo a chama "Leads na
-- etapa"; a UI a rotula "Negócios na etapa". Três nomes, uma conta, nenhuma
-- correta. 12% de erro num número de operação, hoje, sem virada nenhuma.
--
-- A ORDEM: RENOMEAR ANTES DE TROCAR A FONTE
--
-- Duas medidas, uma conta cada, cada nome dizendo a verdade:
--
--   `negocios_na_etapa`  (NOVA)  = COUNT(*) de entrada aberta        → 41.025
--   `leads_na_etapa`     (EXISTE) = COUNT(DISTINCT lead_id)          → 36.073
--
-- A aritmética antiga NÃO se perde: ela migra inteira para o id novo, cujo nome
-- descreve o que ela sempre mediu. O id antigo permanece — painéis salvos em
-- `metrics_studio_panels` referenciam `leads_na_etapa` e continuam abrindo — mas
-- passa a contar PESSOA, que é o que o nome sempre prometeu.
--
-- ⚠ CONSEQUÊNCIA ASSUMIDA, e é o motivo de estar escrita aqui: painel salvo
-- apontando para `leads_na_etapa` cai de 41.025 para 36.073 no dia do apply.
-- Isso é a correção, não o efeito colateral dela. O raio é conhecido e é zero
-- hoje: o Estúdio inteiro está atrás de `organizations.metrics_studio_enabled`,
-- que não está em prod (migration 20270811100000) — nenhum cliente vê estes
-- números ainda. É a última janela em que essa troca é grátis.
--
-- O QUE `negocios_abertos` ACRESCENTA, E POR QUE A CONVERSÃO PRECISAVA DELA
--
-- `conversao` = num_vendas ÷ leads_criados. Sob a unidade nova isso é errado por
-- construção: um Lead com 3 Negócios entra UMA vez no denominador e pode ganhar
-- TRÊS vezes no numerador — a taxa passa de 100%. Medido em prod (ADR-0023
-- §decisão 6): 4.380 Leads têm vários Negócios abertos ao mesmo tempo.
--
-- `negocios_abertos` conta a ABERTURA de negócio na janela (`entered_at`), e a
-- razão `conversao_negocio` divide venda por negócio aberto — mesma unidade nos
-- dois lados. A `conversao` velha FICA: "vendas por lead que entrou" continua
-- sendo pergunta legítima da operação. O que ela não pode é continuar sendo a
-- única, chamada só de "conversão".
--
-- ⚠ As duas razões dividem âncoras diferentes (`fechamentos` ÷ `entradas`) — o
-- motor devolve só a âncora do numerador. É o mesmo desvio que a `conversao`
-- semeada em 2026-07 já tem, e é deliberado: conversão É a pergunta que cruza
-- coortes. A guarda (c) da 20270812100001 é escopada aos filhos daquela fatia,
-- então não reprova aqui; a guarda (d), que vale para TODAS as linhas, reprova
-- se o formato não bater com a unidade derivada — e count÷count→percent→
-- `percent_1` bate.
--
-- `sale_events.deal_id`: A RECEITA PRECISA APONTAR PARA O NEGÓCIO
--
-- O caderno de vendas aponta para `lead_id` e para `pipeline_id`+`stage_key`;
-- não existe coluna que ligue a venda ao Negócio que a produziu. Enquanto não
-- existir, "receita por negócio" é derivada por join frouxo e "qual dos 3
-- negócios deste lead fechou" é impossível de responder.
--
-- Esta fatia acrescenta a coluna NULÁVEL e o índice, e NADA MAIS: nenhum
-- backfill, nenhuma escrita, nenhum leitor novo. `deals` tem 0 linhas em prod e
-- `abrir_negocio`/`mover_negocio` não estão aplicadas — backfill aqui inventaria
-- vínculo. Quem popula é o produtor, na fatia que acender o Negócio. Guarda F4
-- respeitada: schema, não dado.
--
-- AUTOSSUFICIENTE — tudo idempotente (`ON CONFLICT DO NOTHING`,
-- `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`), sem pressupor ordem de
-- apply em relação a nenhuma outra migration do épico.
--
-- ROLLBACK pareado: rollback/20270813100000_metric_negocio_semantica.sql

-- ===========================================================================
-- 1 — CATÁLOGO: as duas medidas novas, e a correção do rótulo da velha
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('negocios_na_etapa', 'Negócios na etapa', 'count', 'hoje',
   'Estado atual: negócios abertos ocupando etapa. Um lead com 3 negócios conta 3 — é a unidade do funil (ADR-0023).', 61),
  ('negocios_abertos',  'Negócios abertos',  'count', 'entradas',
   'Negócios que passaram a ocupar etapa dentro da janela (entered_at). Denominador honesto da conversão: mesma unidade do numerador.', 62)
ON CONFLICT (id) DO NOTHING;

-- Catálogo é dado de SISTEMA (guarda F4 intacta): se a linha já existir com o
-- texto antigo, o UPDATE a alinha. `leads_na_etapa` passa a dizer o que a conta
-- desta migration faz — PESSOA distinta, não entrada.
UPDATE public.metric_catalog_measures
   SET label       = 'Leads na etapa',
       description = 'Estado atual: PESSOAS distintas com negócio aberto em etapa. Um lead com 3 negócios conta 1. Para contar negócio, use "Negócios na etapa".'
 WHERE id = 'leads_na_etapa';

UPDATE public.metric_catalog_measures
   SET label       = 'Negócios na etapa',
       description = 'Estado atual: negócios abertos ocupando etapa. Um lead com 3 negócios conta 3 — é a unidade do funil (ADR-0023).'
 WHERE id = 'negocios_na_etapa';

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('negocios_na_etapa', 'total'),
  ('negocios_na_etapa', 'pipeline'),
  ('negocios_na_etapa', 'etapa'),
  ('negocios_abertos',  'total'),
  ('negocios_abertos',  'pipeline'),
  ('negocios_abertos',  'etapa'),
  ('negocios_abertos',  'origem'),
  ('negocios_abertos',  'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('negocios_na_etapa', 'integer'),
  ('negocios_abertos',  'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — RECEITA APONTA PARA O NEGÓCIO (schema, sem dado)
-- ===========================================================================
ALTER TABLE public.sale_events ADD COLUMN IF NOT EXISTS deal_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sale_events_deal_id_fkey' AND conrelid = 'public.sale_events'::regclass
  ) THEN
    ALTER TABLE public.sale_events
      ADD CONSTRAINT sale_events_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_sale_events_deal_id
  ON public.sale_events (deal_id) WHERE deal_id IS NOT NULL;

COMMENT ON COLUMN public.sale_events.deal_id IS
  'Negócio que produziu esta venda (ADR-0023 negocio-is-the-funnel-unit). '
  'NULA para todo o histórico e para produtor que ainda não conhece Negócio — '
  'preenchida pelo produtor a partir da fatia que acender abrir/mover_negocio. '
  'Nenhum leitor de receita depende dela hoje; existe para que "qual dos N '
  'negócios deste lead fechou" deixe de ser impossível de responder.';

-- ===========================================================================
-- 3 — LEAF DE SNAPSHOT, agora com UNIDADE DE CONTAGEM explícita
-- ===========================================================================
-- Assinatura nova (4 argumentos). O 4º é `p_unidade`, valor de conjunto fechado
-- escolhido pelo CASE — dado, nunca identificador, nunca concatenado. A versão
-- de 3 argumentos é derrubada no fim desta migration: manter as duas seria
-- manter viva a conta que este arquivo existe para corrigir.
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb, p_unidade text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  IF p_unidade NOT IN ('negocio', 'lead') THEN
    RAISE EXCEPTION 'unidade % desconhecida no snapshot de etapa', p_unidade
      USING ERRCODE = '22023';
  END IF;

  -- Base para `empty_reason`: existe LINHA na janela? Conta entrada nos dois
  -- modos de propósito — "sem dado" é sobre a existência do funil, não sobre a
  -- unidade escolhida.
  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

  IF p_recorte = 'total' THEN
    -- COUNT(DISTINCT lead_id) ignora NULL por definição do SQL, e é o que se
    -- quer: entrada órfã de lead não é pessoa nenhuma.
    SELECT CASE p_unidade
             WHEN 'negocio' THEN count(*)
             ELSE                count(DISTINCT pe.lead_id)
           END
    INTO v_val
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  ELSE
    -- pipeline | etapa
    --
    -- ⚠ Em `lead`, a soma da série NÃO é o total. Uma pessoa com negócio em
    -- duas etapas conta 1 em cada balde e 1 no total. É a aritmética correta de
    -- distinct por balde, e é por isso que a janela lê o escalar do motor em
    -- vez de somar a série (`headValueFromMeasure` só soma quando o escalar não
    -- veio — recorte não-total sempre traz série, então o caminho não se cruza).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
                 ELSE g.bucket_key
               END, 'Sem valor'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'pipeline' THEN pe.pipeline_id::text
          WHEN 'etapa'    THEN pe.stage_key
        END AS bucket_key,
        CASE p_unidade
          WHEN 'negocio' THEN count(*)
          ELSE                count(DISTINCT pe.lead_id)
        END AS val
      FROM public.pipeline_entries pe
      WHERE pe.organization_id = p_org_id
        AND pe.closed_at IS NULL
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      GROUP BY 1
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- ===========================================================================
-- 4 — LEAF DE NEGÓCIOS ABERTOS (janela, âncora `entradas`)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_negocios_abertos(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  -- `entered_at` é o instante em que o Negócio passou a ocupar etapa. NÃO é
  -- `created_at` da linha nem `updated_at` (anti-padrão 3 do lint de métricas:
  -- qualquer toque moveria o negócio de mês).
  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  LEFT JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.organization_id = p_org_id
    AND pe.entered_at <@ p_bounds
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  ELSE
    -- pipeline | etapa | origem | tempo
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
                 WHEN 'tempo'    THEN to_char(g.bucket_key::date, 'DD/MM')
                 ELSE g.bucket_key
               END, 'Sem valor'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'pipeline' THEN pe.pipeline_id::text
          WHEN 'etapa'    THEN pe.stage_key
          WHEN 'origem'   THEN l.origin
          WHEN 'tempo'    THEN to_char(pe.entered_at AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        count(*) AS val
      FROM public.pipeline_entries pe
      LEFT JOIN public.leads l ON l.id = pe.lead_id
      WHERE pe.organization_id = p_org_id
        AND pe.entered_at <@ p_bounds
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY 1
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- ===========================================================================
-- 5 — DESPACHANTE: 14 vigentes + as 2 desta fatia
-- ===========================================================================
-- Reescrita fiel do corpo de 20270812120000, com dois ramos a mais e a chamada
-- do snapshot passando a UNIDADE. O bloco de `target` vem junto — reescrever o
-- despachante sem ele é exatamente como a 20260727140000 apagou a meta.
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_goal_type text; v_tz text;
  v_bounds tstzrange; v_leaf jsonb; v_target numeric;
BEGIN
  SELECT m.unit, m.anchor, m.goal_type INTO v_unit, v_anchor, v_goal_type
  FROM public.metric_catalog_measures m WHERE m.id = p_measure_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'unknown measure %', p_measure_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = p_measure_id AND mr.recorte_id = p_recorte
  ) THEN
    RAISE EXCEPTION 'recorte % incompatible with measure %', p_recorte, p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_anchor <> 'hoje' THEN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  END IF;

  v_leaf := CASE p_measure_id
    WHEN 'receita'                THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    -- A unidade do funil é o NEGÓCIO (ADR-0023). Os dois ramos abaixo lêem a
    -- MESMA tabela e diferem só na contagem — é essa diferença que a fatia 9
    -- existe para tornar visível.
    WHEN 'negocios_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'negocio')
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'lead')
    WHEN 'negocios_abertos'       THEN public._metric_leaf_negocios_abertos(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
  END;

  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_goal_type IS NOT NULL AND v_bounds IS NOT NULL THEN
    SELECT sum(g.target_value) INTO v_target
    FROM public.goals g
    WHERE g.organization_id = p_org_id
      AND g.type = v_goal_type
      AND g.month = extract(month FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND g.year  = extract(year  FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND (
        ((p_filters->>'member_id') IS NULL AND g.team_member_id IS NULL)
        OR g.team_member_id = (p_filters->>'member_id')::uuid
      );
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'target',  v_target,
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- A de 3 argumentos sai DEPOIS de o despachante já apontar para a de 4. Ficar
-- viva seria manter a conta antiga a um `CREATE OR REPLACE` de distância.
DROP FUNCTION IF EXISTS public._metric_leaf_stage_snapshot(uuid, text, jsonb);

-- ===========================================================================
-- 6 — RAZÃO: conversão na unidade do funil
-- ===========================================================================
INSERT INTO public.metric_catalog_ratios (id, label, num_measure_id, den_measure_id, format_id, sort) VALUES
  ('conversao_negocio', 'Taxa de conversão por negócio', 'num_vendas', 'negocios_abertos', 'percent_1', 50)
ON CONFLICT (id) DO NOTHING;

-- A `conversao` de 2026-07 fica, e ganha o nome do que ela realmente divide.
UPDATE public.metric_catalog_ratios
   SET label = 'Taxa de conversão por lead'
 WHERE id = 'conversao' AND label = 'Taxa de conversão';

-- ===========================================================================
-- 7 — GRANTS
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) TO service_role;

-- ===========================================================================
-- 8 — GUARDA (aborta a transação)
-- ===========================================================================
DO $guard$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure,
    'public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_fn      regprocedure;
  v_orfas   text;
  v_prosrc  text;
  v_row     record;
  v_unit    text;
  v_fmt     text;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: anon executa % — REVOKE não pegou', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: authenticated executa % — interno não pode', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
    END IF;
  END LOOP;

  -- O caminho da RECEITA é o que toda reescrita do despachante põe em risco.
  IF to_regprocedure('public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_sales sumiu — o caminho da receita quebrou';
  END IF;
  IF to_regprocedure('public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_sales_lost sumiu — ganho/perda quebrou';
  END IF;

  -- A de 3 argumentos precisa ter ido embora, senão a conta antiga sobrevive.
  IF to_regprocedure('public._metric_leaf_stage_snapshot(uuid, text, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_stage_snapshot/3 continua viva — a conta antiga sobreviveu';
  END IF;

  SELECT p.prosrc INTO v_prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_metric_leaf' AND p.pronargs = 8;

  -- TODA medida do catálogo tem de estar no CASE (a checagem que a
  -- 20260727140000 não fez).
  SELECT string_agg(m.id, ', ' ORDER BY m.id) INTO v_orfas
  FROM public.metric_catalog_measures m
  WHERE position('''' || m.id || '''' IN v_prosrc) = 0;
  IF v_orfas IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida catalogada sem ramo no despachante: %', v_orfas;
  END IF;

  -- As duas contagens têm de continuar DIFERENTES no texto do despachante. Um
  -- `CREATE OR REPLACE` futuro que copiasse o ramo errado faria "Negócios" e
  -- "Leads" voltarem a ser o mesmo número, em silêncio — que é o defeito que
  -- esta fatia corrige.
  IF position('''negocio''' IN v_prosrc) = 0 OR position('''lead''' IN v_prosrc) = 0 THEN
    RAISE EXCEPTION 'GUARDA: o despachante não distingue mais negócio de lead no snapshot';
  END IF;

  -- Coerência unidade-derivada × formato-declarado, em TODAS as razões (mesma
  -- regra da 20270812100001; repetida porque esta fatia acrescenta linha).
  FOR v_row IN
    SELECT r.id, r.format_id, mn.unit AS num_unit, md.unit AS den_unit
    FROM public.metric_catalog_ratios r
    JOIN public.metric_catalog_measures mn ON mn.id = r.num_measure_id
    JOIN public.metric_catalog_measures md ON md.id = r.den_measure_id
  LOOP
    v_unit := CASE
      WHEN v_row.num_unit = 'count'    AND v_row.den_unit = 'count' THEN 'percent'
      WHEN v_row.num_unit = 'currency' AND v_row.den_unit = 'count' THEN 'currency'
      ELSE 'ratio'
    END;
    -- Fora do IF de propósito: `IF x <> CASE … THEN … END THEN` não compila.
    v_fmt := CASE v_unit
               WHEN 'percent'  THEN 'percent_1'
               WHEN 'currency' THEN 'currency_brl'
               ELSE 'ratio_2'
             END;
    IF v_row.format_id <> v_fmt THEN
      RAISE EXCEPTION
        'GUARDA: razão % deriva unidade % (% ÷ %) mas declara formato % — a tela imprimiria número errado',
        v_row.id, v_unit, v_row.num_unit, v_row.den_unit, v_row.format_id;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;

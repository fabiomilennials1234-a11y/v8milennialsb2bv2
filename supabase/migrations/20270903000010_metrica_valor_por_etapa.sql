-- 20270903000010_metrica_valor_por_etapa.sql
--
-- Duas medidas de dinheiro que faltavam: `valor_em_aberto` ("quanto tenho
-- parado na etapa X") e `valor_perdido` ("quanto saiu pela porta da perda").
--
-- POR QUE `receita` NÃO RESPONDE ISSO
--
-- `receita` é venda FECHADA, líquida de estorno, e vem do caderno
-- `sale_events`. Ela tem 8 recortes e `etapa` não é um deles — de propósito:
-- uma venda fechada não está em etapa nenhuma, ela saiu do funil.
--
-- "Parado na etapa" é o oposto: dinheiro de negócio que NÃO fechou. Não existe
-- evento de venda para ele, e não vai existir enquanto não fechar. Por isso
-- `valor_em_aberto` lê `deals.value` e não o caderno — e essa é a única medida
-- de dinheiro do catálogo que legitimamente não sai de `sale_events`.
--
-- 🔴 Não "corrija" isto para ler o caderno. Ler o caderno devolveria zero, que
-- é a resposta certa para uma pergunta diferente.
--
-- E A OUTRA COLUNA DE VALOR? — MEDIDO, PORQUE ELAS SÃO DUAS
--
-- O funil tem um segundo lugar onde valor mora: `pipeline_entries.metadata->>
-- 'sale_value'`, que é o que o guard de UX (`sale-value-guard.ts`) exige ao
-- ganhar e o que `fn_capture_sale_event` snapshota na transição. Escolher a
-- coluna errada aqui daria um número plausível e diferente do resto do produto.
--
-- Medido em prod 2026-08-27 sobre as 45.128 entradas abertas:
--   102 têm `metadata->>'sale_value'` > 0   (soma R$ 477.834,91)
--   103 têm `deals.value` > 0
--    99 têm as DUAS
--     0 têm as duas e DISCORDAM
--
-- As duas colunas estão em acordo hoje — `abrir_negocio` grava as duas e o
-- trigger `trg_deal_items_sync_value` mantém a primeira. Por isso a escolha de
-- `deals.value` (decisão do CTO) não cria uma segunda verdade: é a mesma
-- verdade por um caminho tipado, em coluna `numeric` em vez de texto dentro de
-- `jsonb`.
--
-- ⚠ Se algum dia a contagem "ambos e DISCORDAM" deixar de ser zero, ESTA
-- medida e o guard passam a responder diferente sobre o mesmo negócio. A
-- consulta acima é o teste; rode-a antes de culpar a métrica.
--
-- `valor_perdido`, ao contrário, TEM evento: sai de `sale_events` com
-- `event_type = 'sale_lost'`, exatamente a mesma consulta de
-- `negocios_perdidos` com `SUM(sale_value)` no lugar de `COUNT(*)`. Assim as
-- duas medidas nunca discordam sobre quais negócios foram perdidos — se
-- divergirem, é bug de uma delas, não de definição.
--
-- A ARITMÉTICA NÃO DOBRA — MEDIDO, NÃO SUPOSTO
--
-- Um negócio em duas etapas somaria o valor duas vezes. Medido em prod
-- 2026-08-27: 32.898 entradas abertas com `deal_id`, 32.898 negócios distintos,
-- ZERO negócios em duas entradas abertas. A relação é 1:1 hoje, então a soma da
-- série bate com o total.
--
-- Isso é um FATO DE HOJE, não um invariante do schema — nada impede a segunda
-- entrada. Por isso o `total` é somado sobre negócio DISTINTO em vez de sobre
-- entrada: se a relação deixar de ser 1:1, o total continua certo e só a série
-- passa a somar mais que ele — a mesma aritmética honesta que `leads_na_etapa`
-- já tem.
--
-- 🔴 O NÚMERO VAI NASCER QUASE VAZIO, E ISSO É O PONTO
--
-- `deals.value` está preenchido em 309 de 35.082 negócios (0,88%), e 213 dos
-- 309 são da Milennials. O valor total em aberto nas 107 orgs é R$ 505.788,32.
-- Além disso, 12.223 das 45.121 entradas abertas não têm `deal_id` nenhum e
-- portanto valem R$ 0 aqui.
--
-- A medida existe assim mesmo porque o motor precisa existir antes de a UI
-- poder exigir o preenchimento (fatia 3). O que NÃO se faz é backfill: valor de
-- negócio de cliente não se inventa. A cobertura viaja no retorno
-- (`coverage_*`) para a janela poder dizer "valor em 12 de 4.093 negócios" em
-- vez de deixar ler R$ 15.924,21 como se fosse o funil inteiro.
--
-- ANEXO AO DESFECHO DA ETAPA — E A SEGUNDA FONTE QUE QUASE FICOU DE FORA
--
-- `is_final_positive` / `is_final_negative` já existem e estão preenchidas em
-- 4.190 de 4.190 etapas de `pipeline_stages` (382 positivas, 263 negativas, 106
-- orgs). `valor_em_aberto` EXCLUI etapa final dos dois lados: negócio parado
-- numa etapa de ganho ou de perda não está parado, está resolvido. Sem isso o
-- número somaria o cemitério ao pipeline.
--
-- 🔴 Só que a etapa vive em DUAS tabelas. `pipeline_stages` guarda as etapas
-- dos funis de sistema (casadas por `pipeline_type = pipelines.slug`);
-- `custom_pipeline_stages` guarda as dos funis personalizados (casadas por
-- `pipeline_id`). As duas têm as mesmas flags.
--
-- Medido em prod 2026-08-27 sobre as 45.121 entradas abertas: 28.576 resolvem
-- em `pipeline_stages`, **16.493 resolvem SÓ em `custom_pipeline_stages`** e 54
-- não resolvem em nenhuma. Um join só com a primeira tabela deixaria 37% das
-- entradas sem desfecho conhecido — e, como a ausência vira `false`, as etapas
-- de ganho e de perda dos funis personalizados entrariam no "parado".
--
-- Daí `_stage_is_final`, que espelha a cadeia de `_stage_key_label`: tenta a
-- tabela de sistema, cai para a de custom, e só então assume `false`. As 54
-- órfãs contam como não-final, que é o comportamento seguro: aparecer no
-- pipeline é recuperável, sumir do pipeline é invisível.
--
-- ATRIBUIÇÃO: UMA CHAVE, NUNCA CADEIA
--
-- O recorte `closer` usa `deals.owner_id` e ponto — sem COALESCE com
-- `assigned_to` da entrada (anti-padrão 2 do lint de métricas: cadeia de
-- fallback faz `SUM(membro) ≠ total`). `owner_id` está em 8.622 de 33.547
-- negócios abertos; o resto cai no balde "Sem responsável", que é a verdade.
--
-- ROLLBACK pareado: rollback/20270903000010_metrica_valor_por_etapa.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('valor_em_aberto', 'Valor parado na etapa', 'currency', 'hoje',
   'Soma do valor dos negócios abertos, por etapa. Exclui etapa final de ganho e de perda.', 76),
  ('valor_perdido', 'Valor perdido', 'currency', 'fechamentos',
   'Soma do valor dos negócios perdidos na janela, do caderno de vendas.', 77)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

-- `valor_em_aberto` é estado, então NÃO tem `tempo`: uma série diária de um
-- snapshot repetiria o mesmo número em cada ponto.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('valor_em_aberto', 'total'),
  ('valor_em_aberto', 'etapa'),
  ('valor_em_aberto', 'pipeline'),
  ('valor_em_aberto', 'closer'),
  ('valor_em_aberto', 'origem'),
  -- Espelha `negocios_perdidos` linha a linha: mesma fonte, mesmos recortes.
  ('valor_perdido', 'total'),
  ('valor_perdido', 'closer'),
  ('valor_perdido', 'origem'),
  ('valor_perdido', 'pipeline'),
  ('valor_perdido', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('valor_em_aberto', 'currency_brl'),
  ('valor_perdido',   'currency_brl')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — A ETAPA É FINAL?
-- ===========================================================================
-- Espelha a cadeia de `_stage_key_label`: sistema → custom → padrão. Sem isso,
-- 37% das entradas abertas ficariam sem desfecho conhecido (ver o cabeçalho).
--
-- É chamada por linha, e é barato: dois lookups por índice, e a consulta já
-- está escopada por organização. `COALESCE` por coluna porque `NULL OR false`
-- é `NULL`, não `false` — a etapa cairia em "desconhecido" por aritmética de
-- três valores em vez de por ausência de linha.
CREATE OR REPLACE FUNCTION public._stage_is_final(
  p_org_id uuid, p_pipeline_id uuid, p_stage_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(ps.is_final_positive, false) OR COALESCE(ps.is_final_negative, false)
       FROM public.pipeline_stages ps
       JOIN public.pipelines pl ON pl.id = p_pipeline_id AND pl.organization_id = p_org_id
      WHERE ps.pipeline_type = pl.slug
        AND ps.stage_key = p_stage_key
        AND ps.organization_id = p_org_id
      LIMIT 1),
    (SELECT COALESCE(cps.is_final_positive, false) OR COALESCE(cps.is_final_negative, false)
       FROM public.custom_pipeline_stages cps
      WHERE cps.pipeline_id = p_pipeline_id
        AND cps.stage_key = p_stage_key
        AND cps.organization_id = p_org_id
      LIMIT 1),
    -- Etapa que não existe em tabela nenhuma (54 em prod) conta como NÃO final:
    -- aparecer no pipeline por engano é visível, sumir dele não é.
    false
  );
$$;

COMMENT ON FUNCTION public._stage_is_final(uuid, uuid, text) IS
  'Etapa é desfecho (ganho ou perda)? Resolve em pipeline_stages e em custom_pipeline_stages — 37% das entradas abertas só existem na segunda.';

-- ===========================================================================
-- 3 — VALOR PARADO NA ETAPA
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_valor_em_aberto(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_scoped boolean;
  v_base_count bigint; v_com_valor bigint;
BEGIN
  IF p_recorte NOT IN ('total', 'etapa', 'pipeline', 'closer', 'origem') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure valor_em_aberto', p_recorte
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  -- Cobertura: quantos negócios abertos existem, e em quantos deles há valor.
  -- É o que impede a janela de deixar um número parcial passar por completo.
  -- Cobertura conta ENTRADA aberta com negócio; o total soma NEGÓCIO distinto.
  -- Hoje é a mesma população (1:1 medido), e a diferença só apareceria se a
  -- relação deixasse de ser 1:1 — quando a cobertura passaria a ser o
  -- denominador certo mesmo assim: ela responde "em quantos cards há valor".
  SELECT count(*), count(*) FILTER (WHERE d.value IS NOT NULL AND d.value > 0)
  INTO v_base_count, v_com_valor
  FROM public.pipeline_entries pe
  JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
  LEFT JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    -- Soma sobre negócio DISTINTO: hoje a relação com entrada é 1:1, e se
    -- deixar de ser o total continua certo. Ver o cabeçalho.
    SELECT COALESCE(sum(x.valor), 0) INTO v_val
    FROM (
      SELECT DISTINCT d.id, d.value AS valor
      FROM public.pipeline_entries pe
      JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
      LEFT JOIN public.leads l ON l.id = pe.lead_id
      WHERE pe.organization_id = p_org_id
        AND pe.closed_at IS NULL
        AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    ) x;

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',   g.bucket_key,
           'label', COALESCE(g.bucket_label, 'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN pe.pipeline_id::text
        WHEN 'etapa'    THEN pe.pipeline_id::text || ':' || pe.stage_key
        WHEN 'closer'   THEN d.owner_id::text
        WHEN 'origem'   THEN l.origin
      END AS bucket_key,
      CASE p_recorte
        WHEN 'pipeline' THEN pip.name
        WHEN 'etapa'    THEN public._stage_bucket_label(
                               p_org_id, pe.pipeline_id, pe.stage_key, v_scoped)
        -- Uma chave canônica, sem cadeia de fallback. Sem dono é balde próprio.
        WHEN 'closer'   THEN COALESCE(tm.name, 'Sem responsável')
        WHEN 'origem'   THEN l.origin
      END AS bucket_label,
      COALESCE(sum(d.value), 0) AS val
    FROM public.pipeline_entries pe
    JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
    LEFT JOIN public.leads l ON l.id = pe.lead_id
    LEFT JOIN public.team_members tm ON tm.id = d.owner_id
    LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND NOT public._stage_is_final(p_org_id, pe.pipeline_id, pe.stage_key)
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR d.owner_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
    'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_valor_em_aberto(uuid, text, jsonb) IS
  'Soma de deals.value em negócio aberto, fora de etapa final. NÃO sai de sale_events de propósito: negócio aberto não tem evento de venda. Devolve cobertura junto.';

-- ===========================================================================
-- 4 — VALOR PERDIDO
-- ===========================================================================
-- Mesma consulta de `_metric_leaf_sales_lost`, com SUM(sale_value) no lugar de
-- COUNT(*). Duplicar a consulta em vez de parametrizar a irmã é deliberado:
-- `_metric_leaf_sales_lost` já está em prod e é lida por `negocios_perdidos`;
-- mexer nela para acomodar uma segunda unidade arrisca a medida que funciona.
CREATE OR REPLACE FUNCTION public._metric_leaf_valor_perdido(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint; v_com_valor bigint;
BEGIN
  IF p_recorte NOT IN ('total', 'closer', 'origem', 'pipeline', 'tempo') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure valor_perdido', p_recorte
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE w.sale_value IS NOT NULL AND w.sale_value > 0)
  INTO v_base_count, v_com_valor
  FROM public.sale_events w
  LEFT JOIN public.leads l ON l.id = w.lead_id
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale_lost'
    AND w.sold_at <@ p_bounds
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                    WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
    AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    SELECT COALESCE(sum(w.sale_value), 0) INTO v_val
    FROM public.sale_events w
    LEFT JOIN public.leads l ON l.id = w.lead_id
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale_lost'
      AND w.sold_at <@ p_bounds
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
      AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key,
           'label', COALESCE(
             CASE p_recorte WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM') ELSE g.bucket_label END,
             'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'closer'   THEN w.sale_responsible_id::text
        WHEN 'origem'   THEN l.origin
        WHEN 'pipeline' THEN w.pipeline_id::text
        WHEN 'tempo'    THEN to_char(w.sold_at AT TIME ZONE p_tz, 'YYYY-MM-DD')
      END AS bucket_key,
      CASE p_recorte
        WHEN 'closer'   THEN tm.name
        WHEN 'origem'   THEN l.origin
        WHEN 'pipeline' THEN pip.name
        WHEN 'tempo'    THEN NULL
      END AS bucket_label,
      COALESCE(sum(w.sale_value), 0) AS val
    FROM public.sale_events w
    LEFT JOIN public.leads l          ON l.id   = w.lead_id
    LEFT JOIN public.team_members tm  ON tm.id  = w.sale_responsible_id
    LEFT JOIN public.pipelines pip    ON pip.id = w.pipeline_id
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale_lost'
      AND w.sold_at <@ p_bounds
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
      AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
    'coverage_total', v_base_count, 'coverage_com_valor', v_com_valor);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_valor_perdido(uuid, text, tstzrange, text, jsonb) IS
  'Soma de sale_value dos eventos sale_lost não estornados. Espelha negocios_perdidos: mesma fonte, mesmos filtros, SUM no lugar de COUNT.';

-- ===========================================================================
-- 5 — DESPACHANTE (corpo vigente de 20270821240000 + DOIS ramos + cobertura)
-- ===========================================================================
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
    WHEN 'ltv'                    THEN public._metric_leaf_ltv(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas_pre_venda'   THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters, true)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'ganho_perda'            THEN public._metric_leaf_ganho_perda(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'negocio')
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'lead')
    WHEN 'negocios_abertos'       THEN public._metric_leaf_negocios_abertos(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    -- SCRUM-545 fatia 2 — as duas medidas de dinheiro do funil.
    WHEN 'valor_em_aberto'        THEN public._metric_leaf_valor_em_aberto(p_org_id, p_recorte, p_filters)
    WHEN 'valor_perdido'          THEN public._metric_leaf_valor_perdido(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'clientes_sem_resposta'  THEN public._metric_leaf_clientes_sem_resposta(p_org_id, p_recorte, p_filters)
    WHEN 'disparos_entregues'     THEN public._metric_leaf_automacao(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'entregues')
    WHEN 'disparos_respondidos'   THEN public._metric_leaf_automacao(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'respondidos')
    WHEN 'clientes_sem_atuacao'   THEN public._metric_leaf_clientes_sem_atuacao(p_org_id, p_recorte, p_filters)
    WHEN 'curva_abc'              THEN public._metric_leaf_curva_abc(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    -- SCRUM-316. As três partilham a MESMA coorte; ver o cabeçalho da 20270821120000.
    WHEN 'negocios_coorte_origem'      THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'origem')
    WHEN 'negocios_coorte_convertidos' THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'convertidos')
    WHEN 'negocios_coorte_em_aberto'   THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'em_aberto')
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
    'empty_reason', v_leaf->>'empty_reason',
    -- Só as medidas de dinheiro do funil devolvem cobertura. Nas outras as duas
    -- chaves vêm NULL e o front não desenha o aviso.
    'coverage_total',     v_leaf->'coverage_total',
    'coverage_com_valor', v_leaf->'coverage_com_valor'
  );
END;
$$;

-- ===========================================================================
-- 6 — GRANTS + GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._stage_is_final(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._stage_is_final(uuid, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf_valor_em_aberto(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_valor_em_aberto(uuid, text, jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf_valor_perdido(uuid, text, tstzrange, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_valor_perdido(uuid, text, tstzrange, text, jsonb)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._stage_is_final(uuid, uuid, text)'::regprocedure,
    'public._metric_leaf_valor_em_aberto(uuid, text, jsonb)'::regprocedure,
    'public._metric_leaf_valor_perdido(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_sem_ramo text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: anon executa % — interno do motor não pode', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: authenticated executa % — interno do motor não pode', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef(
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure);

  SELECT string_agg(m.id, ', ') INTO v_sem_ramo
  FROM public.metric_catalog_measures m
  WHERE position(quote_literal(m.id) IN v_def) = 0;

  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida(s) catalogada(s) sem ramo no despachante: %', v_sem_ramo;
  END IF;
END
$guard$;

-- 20270903000000_metrica_por_etapa_para_de_degradar.sql
--
-- O recorte `etapa` volta a recortar por etapa quando NENHUM funil foi
-- escolhido. Hoje ele devolve um escalar e chama de `total`.
--
-- O DEFEITO, medido em prod 2026-08-27
--
-- `_metric_leaf_stage_duration` e `_metric_leaf_stage_snapshot` carregam o mesmo
-- ramo:
--
--     IF p_recorte = 'etapa' AND NOT v_scoped THEN ... effective_recorte='total'
--
-- `v_scoped` é `p_filters->>'pipeline_id' IS NOT NULL`. Ou seja: pediu por
-- etapa sem filtrar um funil, o motor entrega UM número.
--
-- Isso atinge TRÊS medidas — `tempo_medio_etapa`, `negocios_na_etapa` e
-- `leads_na_etapa` — e a primeira é a mais grave, porque ela é a ÚNICA medida
-- do catálogo sem `total`. Sem `total`, o corte default da janela é `etapa`; a
-- janela nasce sem filtro de funil; o caminho default cai direto na degradação.
-- Resultado em prod, hoje: a janela "Tempo médio na etapa" mostra 47,8 dias
-- (Milennials) e 43,8 dias (Chique Distribuidora) — um número só, rotulado
-- "total", numa janela que se chama "na etapa".
--
-- A mesma função, com o funil escolhido, já entregava a série correta:
-- Novo Lead 45,3d · Reunião representantes 15,1d · Proposta Enviada 7,2d.
-- O dado sempre esteve lá. O default é que nunca chegava nele.
--
-- POR QUE A DEGRADAÇÃO EXISTIA, E POR QUE ELA NÃO PRECISA EXISTIR
--
-- `stage_key` é único DENTRO de um funil, não na organização: dois funis podem
-- ter `novo`. Agrupar só por `stage_key` sem escopo somaria etapas homônimas de
-- funis diferentes num balde só, e `_stage_key_label` — que precisa do
-- `pipeline_id` para resolver o nome — devolveria o slug cru. Degradar para
-- `total` foi a saída conservadora.
--
-- A saída certa é agrupar pelo PAR `(pipeline_id, stage_key)`, que é único por
-- construção, e rotular "Funil › Etapa". O rótulo composto só aparece quando
-- não há funil escolhido; com funil escolhido o rótulo continua sendo só o nome
-- da etapa, porque o funil já está dito no filtro da janela.
--
-- O QUE MUDA PARA QUEM JÁ TEM PAINEL
--
-- A `key` da série passa de `<stage_key>` para `<pipeline_id>:<stage_key>` no
-- recorte `etapa` sem escopo. Nada persiste `key`: `metrics_studio_panels.layout`
-- guarda `metricId`, corte e filtros, nunca as chaves da série — elas são
-- recalculadas a cada abertura. Os 7 painéis salvos em prod continuam abrindo.
--
-- O que MUDA de verdade é o número na tela: a janela deixa de mostrar um
-- escalar e passa a mostrar a quebra. É a correção, não o efeito colateral.
--
-- DDL PURA (guarda F4): só substitui função. Nenhum dado de cliente é lido para
-- escrita, nenhuma linha é criada ou movida.
--
-- ROLLBACK pareado: rollback/20270903000000_metrica_por_etapa_para_de_degradar.sql

-- ===========================================================================
-- 1 — RÓTULO DO BALDE DE ETAPA
-- ===========================================================================
-- Existe para que os dois leaves rotulem igual. Antes desta migration a
-- composição do rótulo estava embutida em cada um, e só no ramo escopado.
CREATE OR REPLACE FUNCTION public._stage_bucket_label(
  p_org_id uuid,
  p_pipeline_id uuid,
  p_stage_key text,
  -- true = a janela já filtrou um funil, então o nome dele seria repetição.
  p_escopado boolean
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT CASE
    WHEN p_escopado THEN public._stage_key_label(p_org_id, p_pipeline_id, p_stage_key)
    ELSE COALESCE(
           (SELECT p.name FROM public.pipelines p
             WHERE p.id = p_pipeline_id AND p.organization_id = p_org_id),
           'Sem funil'
         ) || ' › ' || public._stage_key_label(p_org_id, p_pipeline_id, p_stage_key)
  END;
$$;

COMMENT ON FUNCTION public._stage_bucket_label(uuid, uuid, text, boolean) IS
  'Rótulo de um balde de etapa. Sem funil escolhido, prefixa "Funil › " porque stage_key só é único dentro do funil.';

-- ===========================================================================
-- 2 — TEMPO MÉDIO NA ETAPA
-- ===========================================================================
-- Corpo vigente de 20260723100100, MENOS o ramo de degradação.
--
-- O que NÃO muda aqui, e continua sendo dívida honesta: a conta é
-- `now() - occurred_at` do ÚLTIMO evento, ou seja o dwell de quem está parado
-- AGORA, não o tempo de travessia histórico da etapa. A descrição no catálogo
-- diz "dwell atual"; o rótulo na tela diz "Tempo médio na etapa", e um gestor
-- lê a segunda coisa. Trocar a conta muda o significado da medida e merece
-- decisão própria — não entra numa migration que se propõe a destravar o
-- recorte. Mesma razão para a medida ignorar o período da janela.
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_duration(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint; v_scoped boolean;
BEGIN
  IF p_recorte NOT IN ('etapa', 'pipeline') THEN
    RAISE EXCEPTION 'recorte % incompatible with measure tempo_medio_etapa', p_recorte
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  SELECT count(*) INTO v_base_count
  FROM (
    SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id) pse.id
    FROM public.pipeline_stage_events pse
    WHERE pse.organization_id = p_org_id
      AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',   g.bucket_key,
           'label', COALESCE(g.bucket_label, 'Sem valor'),
           'value', round(g.avg_secs)
         ) ORDER BY g.avg_secs DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN latest.pipeline_id::text
        -- O par é a chave: `stage_key` sozinho colidiria entre funis.
        WHEN 'etapa'    THEN latest.pipeline_id::text || ':' || latest.to_stage_key
      END AS bucket_key,
      CASE p_recorte
        WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = latest.pipeline_id)
        WHEN 'etapa'    THEN public._stage_bucket_label(
                               p_org_id, latest.pipeline_id, latest.to_stage_key, v_scoped)
      END AS bucket_label,
      avg(extract(epoch FROM (now() - latest.occurred_at))) AS avg_secs
    FROM (
      SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id)
        pse.pipeline_id, pse.to_stage_key, pse.occurred_at
      FROM public.pipeline_stage_events pse
      WHERE pse.organization_id = p_org_id
        AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
    ) latest
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_stage_duration(uuid, text, jsonb) IS
  'Dwell atual médio por etapa. Recorta por (funil, etapa) mesmo sem funil escolhido — antes degradava para total em silêncio.';

-- ===========================================================================
-- 3 — NEGÓCIOS / LEADS NA ETAPA
-- ===========================================================================
-- Corpo vigente de 20270813100000, com a mesma remoção. `total` continua
-- devolvendo escalar: ali a degradação não existe, é o recorte pedido.
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb, p_unidade text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint; v_scoped boolean;
BEGIN
  IF p_unidade NOT IN ('negocio', 'lead') THEN
    RAISE EXCEPTION 'unidade % desconhecida no snapshot de etapa', p_unidade
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

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
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'effective_recorte', 'total');
  END IF;

  -- ⚠ Em `lead`, a soma da série NÃO é o total. Uma pessoa com negócio em duas
  -- etapas conta 1 em cada balde e 1 no total. É a aritmética correta de
  -- distinct por balde, e é por isso que a janela lê o escalar do motor em vez
  -- de somar a série (`headValueFromMeasure` só soma quando o escalar não veio
  -- — recorte não-total sempre traz série, então o caminho não se cruza).
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
      END AS bucket_key,
      CASE p_recorte
        WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = pe.pipeline_id)
        WHEN 'etapa'    THEN public._stage_bucket_label(
                               p_org_id, pe.pipeline_id, pe.stage_key, v_scoped)
      END AS bucket_label,
      CASE p_unidade
        WHEN 'negocio' THEN count(*)
        ELSE                count(DISTINCT pe.lead_id)
      END AS val
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb, text) IS
  'Negócios/leads abertos por etapa. Recorta por (funil, etapa) mesmo sem funil escolhido — antes degradava para total em silêncio.';

-- ===========================================================================
-- 3.5 — NEGÓCIOS ABERTOS: a MESMA colisão, numa forma pior
-- ===========================================================================
-- `_metric_leaf_negocios_abertos` nunca teve o ramo de degradação — e por isso
-- o defeito dele é mais grave, não menos. No recorte `etapa` ele agrupa por
-- `pe.stage_key` cru e rotula com o próprio slug (`ELSE g.bucket_key`). Sem
-- funil escolhido, a etapa `novo` de CINCO funis diferentes vira UM balde
-- chamado "novo", com a soma dos cinco.
--
-- Não é um rótulo degradado que avisa: é um número somado errado que parece
-- certo. Mesma correção — chave `(pipeline_id, stage_key)` e rótulo
-- "Funil › Etapa".
--
-- O resto do corpo é o vigente de 20270813100000, intocado: `entered_at` como
-- âncora (nunca `updated_at` — anti-padrão 3 do lint), e os filtros de
-- pipeline/origem como estavam.
CREATE OR REPLACE FUNCTION public._metric_leaf_negocios_abertos(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint; v_scoped boolean;
BEGIN
  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

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
  END IF;

  -- pipeline | etapa | origem | tempo
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
        WHEN 'origem'   THEN l.origin
        WHEN 'tempo'    THEN to_char(pe.entered_at AT TIME ZONE p_tz, 'YYYY-MM-DD')
      END AS bucket_key,
      CASE p_recorte
        WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = pe.pipeline_id)
        WHEN 'etapa'    THEN public._stage_bucket_label(
                               p_org_id, pe.pipeline_id, pe.stage_key, v_scoped)
        WHEN 'origem'   THEN l.origin
        WHEN 'tempo'    THEN to_char(pe.entered_at AT TIME ZONE p_tz, 'DD/MM')
      END AS bucket_label,
      count(*) AS val
    FROM public.pipeline_entries pe
    LEFT JOIN public.leads l ON l.id = pe.lead_id
    WHERE pe.organization_id = p_org_id
      AND pe.entered_at <@ p_bounds
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    GROUP BY 1, 2
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb) IS
  'Negócios que entraram na janela. Recorte etapa agrupa por (funil, etapa) — antes somava etapas homônimas de funis diferentes num balde só.';

-- ===========================================================================
-- 4 — GRANTS + GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._stage_bucket_label(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._stage_bucket_label(uuid, uuid, text, boolean)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._stage_bucket_label(uuid, uuid, text, boolean)'::regprocedure,
    'public._metric_leaf_stage_duration(uuid, text, jsonb)'::regprocedure,
    'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure,
    'public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb)'::regprocedure
  ];
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

  -- A degradação que esta migration remove não pode voltar por descuido: se
  -- alguém reintroduzir o ramo, o texto da função volta a casar.
  FOREACH v_fn IN ARRAY ARRAY[
    'public._metric_leaf_stage_duration(uuid, text, jsonb)'::regprocedure,
    'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF v_def ~ 'p_recorte\s*=\s*''etapa''\s+AND\s+NOT\s+v_scoped' THEN
      RAISE EXCEPTION 'GUARDA: % voltou a degradar etapa para total sem escopo de funil', v_fn;
    END IF;
  END LOOP;

  -- A colisão: o balde de etapa tem que ser o PAR. `stage_key` sozinho como
  -- chave de balde soma etapas homônimas de funis diferentes, e é isso que
  -- `negocios_abertos` fazia.
  --
  -- Asserção POSITIVA de propósito: exigir a presença da concatenação é estável,
  -- enquanto procurar a forma velha depende de adivinhar como alguém a
  -- reescreveria. Toda leaf que recorta por etapa passa por aqui.
  FOREACH v_fn IN ARRAY ARRAY[
    'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure,
    'public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position('pipeline_id::text || '':'' || pe.stage_key' IN v_def) = 0 THEN
      RAISE EXCEPTION 'GUARDA: % não compõe o balde de etapa como (funil, etapa) — etapas homônimas colidem entre funis', v_fn;
    END IF;
  END LOOP;
END
$guard$;

-- 20270811170001_metric_tempo_resposta_equipe.sql
--
-- SCRUM-311, fatia 6 de 19: "Tempo médio de resposta" — quanto a equipe demora
-- para responder o cliente.
--
-- FONTE LEGADA
--
-- `get_analytics_engagement_metrics`, campo `kpi_cards.our_avg_response_seconds`,
-- consumido por `useAnalyticsEngajamento` e pelo card TeamResponseTimes.
--
-- A REGRA DE PAREAMENTO, reproduzida sem invenção porque é ela que define a
-- medida:
--
--   para cada mensagem RECEBIDA, a PRÓXIMA mensagem ENVIADA ao mesmo lead,
--   desde que dentro de 12 horas; a medida é a MÉDIA desses intervalos.
--
-- O teto de 12h importa: sem ele, um lead respondido três dias depois entra na
-- média com 259.200 segundos e desloca o número inteiro. O `DISTINCT ON` também
-- não é detalhe — sem ele, uma rajada de cinco mensagens enviadas contaria
-- cinco vezes o mesmo atendimento.
--
-- DOIS DESVIOS DA FONTE LEGADA, DELIBERADOS E MEDIDOS
--
-- 1) A JANELA RECORTA A MENSAGEM, NÃO O LEAD.
--
--    No legado, `scope_messages` só junta com os leads da janela; não filtra o
--    timestamp da mensagem. Ou seja: "tempo de resposta em julho" mede
--    mensagens de QUALQUER época dos leads que ENTRARAM em julho. O seletor de
--    período do Estúdio (SCRUM-313) promete recortar o dado exibido — uma
--    medida cujo período recorta outra coisa mentiria no seletor.
--
-- 2) EXPEDIENTE NO FUSO DA ORGANIZAÇÃO, NÃO EM UTC.
--
--    O legado faz `EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18` sobre um
--    `timestamptz`, o que devolve a hora em UTC. Para BRT (UTC-3) isso é
--    5h–15h local: corta a tarde inteira e inclui a madrugada. O comentário do
--    próprio código diz "business hours (8-19)", que nem bate com o 8..18
--    escrito. Recortar no fuso da org é o que o ADR-0017 §5 exige de toda
--    medida de período.
--
-- CUSTO MEDIDO (org Milennials, julho/2026, em prod 2026-08-11):
--
--     legado  267 pares · média 3.245s (54 min)
--     motor   260 pares · média 2.937s (49 min)
--
-- ~9,5% para baixo. A divergência vai para ticket próprio, junto com a de
-- coorte do `leads_criados` — não é para ser descoberta por alguém comparando
-- duas telas.
--
-- ÂNCORA `entradas`: a janela corta a CHEGADA da mensagem do cliente. Não é
-- fechamento e não é estado atual.
--
-- RECORTES: total, origem, tempo.
--
-- Sem corte por pessoa nesta fatia. "Quem respondeu" viria de
-- `whatsapp_messages.assigned_to` na mensagem ENVIADA, que é um conceito de
-- atribuição diferente do `sale_responsible_id` das medidas de venda — misturar
-- os dois faria dois rankings de pessoas discordarem. E corte por pessoa é
-- gated pela permissão do Ranking (G6). Fatia própria.
--
-- ROLLBACK pareado: rollback/20270811170001_metric_tempo_resposta_equipe.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('tempo_resposta_equipe', 'Tempo médio de resposta', 'duration_seconds', 'entradas',
   'Média do intervalo entre a mensagem do cliente e a próxima resposta da equipe, no expediente da organização e com teto de 12h.', 75)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('tempo_resposta_equipe', 'total'),
  ('tempo_resposta_equipe', 'origem'),
  ('tempo_resposta_equipe', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('tempo_resposta_equipe', 'duration_human')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — LEAF
-- ===========================================================================
-- Tudo em CTE, e não em tabela temporária: a função é STABLE, e o Postgres
-- trata STABLE como somente-leitura — `CREATE TEMP TABLE` aqui levantaria
-- 25006.
CREATE OR REPLACE FUNCTION public._metric_leaf_tempo_resposta(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_pares bigint;
BEGIN
  WITH recebidas AS (
    SELECT wm.id, wm.lead_id, wm.timestamp::timestamptz AS ts
    FROM public.whatsapp_messages wm
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'incoming'
      AND wm.lead_id IS NOT NULL
      AND wm.timestamp IS NOT NULL
      AND wm.timestamp::timestamptz <@ p_bounds
      -- Expediente no fuso da ORG. O legado fazia isto em UTC.
      AND EXTRACT(HOUR FROM (wm.timestamp::timestamptz AT TIME ZONE p_tz)) BETWEEN 8 AND 18
  ),
  enviadas AS (
    SELECT wm.lead_id, wm.timestamp::timestamptz AS ts
    FROM public.whatsapp_messages wm
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'outgoing'
      AND wm.lead_id IS NOT NULL
      AND wm.timestamp IS NOT NULL
  ),
  pares AS (
    SELECT DISTINCT ON (r.id)
      r.id AS inbound_id,
      l.origin,
      to_char(r.ts AT TIME ZONE p_tz, 'YYYY-MM-DD') AS dia,
      EXTRACT(EPOCH FROM (e.ts - r.ts)) AS segundos
    FROM recebidas r
    JOIN public.leads l ON l.id = r.lead_id AND l.deleted_at IS NULL
    JOIN enviadas e
      ON  e.lead_id = r.lead_id
      AND e.ts > r.ts
      AND e.ts < r.ts + interval '12 hours'
    WHERE ((p_filters->>'origin') IS NULL OR l.origin = (p_filters->>'origin'))
      AND ((p_filters->>'tag_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
             WHERE lt.lead_id = r.lead_id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
    ORDER BY r.id, e.ts
  )
  SELECT count(*),
         ROUND(AVG(segundos)),
         COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
              'key', g.bucket_key,
              'label', COALESCE(
                CASE p_recorte WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM') ELSE g.bucket_key END,
                'Sem valor'),
              'value', g.val) ORDER BY g.val DESC)
            FROM (
              SELECT CASE p_recorte WHEN 'origem' THEN origin ELSE dia END AS bucket_key,
                     ROUND(AVG(segundos)) AS val
              FROM pares GROUP BY 1
            ) g),
           '[]'::jsonb)
  INTO v_pares, v_val, v_series
  FROM pares;

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_pares = 0 THEN 'no_rows' ELSE NULL END);
  END IF;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_pares = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

-- ===========================================================================
-- 3 — DESPACHANTE
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_tz text; v_bounds tstzrange; v_leaf jsonb;
BEGIN
  SELECT m.unit, m.anchor INTO v_unit, v_anchor
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
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
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

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- ===========================================================================
-- 4 — GRANTS E GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) TO service_role;

DO $guard$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_tempo_resposta(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_fn regprocedure;
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

  IF to_regprocedure('public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_sales sumiu — o caminho da receita quebrou';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;

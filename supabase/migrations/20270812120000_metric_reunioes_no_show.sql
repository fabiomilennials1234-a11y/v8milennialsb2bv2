-- 20270812120000_metric_reunioes_no_show.sql
--
-- SCRUM-311, fatia 8 de 19: "Reuniões no-show" — e a reconciliação da migration
-- que a prendia.
--
-- ESTA FATIA EXISTE PORQUE A RECEITA DOCUMENTADA ESTÁ ERRADA
--
-- O SPEC (`.specs/features/metricas-v2/SPEC.md` §4) e o handoff mandam "aplicar
-- `20260727140000` se no-show ou meta entrarem em escopo". Seguir isso ao pé da
-- letra QUEBRA o motor, e vale escrever por quê antes de qualquer SQL:
--
-- Aquela migration faz `CREATE OR REPLACE` de `_metric_leaf` com o `CASE` de
-- **8** medidas — o corpo que existia em 2026-07. O corpo vigente
-- (`20270811170001`) tem **13**, porque as seis fatias anteriores do SCRUM-311
-- acrescentaram as suas. Como `20260727140000` ordena ANTES delas, um `db push`
-- a aplica primeiro e as 2027 a sobrescrevem depois. Resultado medido:
--
--   • `reunioes_no_show` fica CATALOGADA e SEM ramo no despachante → toda
--     abertura da janela levanta 22023 ("measure has no leaf implementation");
--   • o bloco de `target` que ela instala em `_metric_leaf` é APAGADO pelas
--     2027, que não o conhecem — a meta some sem ninguém notar.
--
-- Ou seja: aplicar aquela migration hoje entrega uma medida que só sabe dar
-- erro e uma meta que evapora. Esta fatia absorve as duas metades no corpo
-- ATUAL, que é o único lugar onde elas sobrevivem.
--
-- POR QUE UMA MIGRATION SÓ, E NÃO DUAS
--
-- No-show e alvo são assuntos diferentes e mereceriam fatias diferentes — mas
-- moram na MESMA função. Duas migrations seriam duas reescritas de
-- `_metric_leaf`, e cada reescrita é um risco no caminho da RECEITA. Uma só,
-- com regressão explícita de `receita` e `num_vendas` na suíte.
--
-- AUTOSSUFICIENTE DE PROPÓSITO
--
-- Tudo aqui é idempotente (`ON CONFLICT DO NOTHING`, `ADD COLUMN IF NOT EXISTS`,
-- `CREATE OR REPLACE`) e NÃO pressupõe que `20260727140000` tenha rodado. O repo
-- carrega 41 migrations pendentes e drift conhecido contra o ledger de prod;
-- migration que depende da ordem de outra é como se descobre um `42P07`. Se
-- aquela rodar antes, esta reescreve por cima com o mesmo conteúdo; se nunca
-- rodar, esta se basta.
--
-- ⚠ O NÚMERO QUE ESTA MEDIDA DEVOLVE NÃO É "NO-SHOW", E QUEM MOSTRAR PRECISA SABER
--
-- Medido em prod, 74 dias desde 2026-06-01: **627 marcadas × 159 comparecidas**.
-- A medida diria 75% de não comparecimento. Isso não descreve o cliente — ele
-- não falta a 3 de cada 4 reuniões. Descreve a operação: `meeting_held` só nasce
-- quando alguém move o card para a etapa de comparecimento, e quase ninguém
-- move. A medida é, hoje, um termômetro de REGISTRO, não de comparecimento.
--
-- Fica no catálogo porque a aritmética está certa e porque a lacuna de registro
-- é exatamente o que a operação precisa enxergar. Mas o rótulo do widget não
-- pode prometer outra coisa, e o `description` abaixo diz isso em português.
--
-- CLAMP ≥ 0 E O RECORTE POR DIA
--
-- `held` sem `booked` correspondente é ruído de dado, nunca no-show negativo —
-- daí o `GREATEST(..., 0)`. O clamp distorce quando a reunião é marcada num
-- bucket e realizada em outro, o que no recorte `tempo` (bucket = dia) seria
-- fatal em tese. Medido: somando o clamp dia a dia dá **475**, contra **468** do
-- período inteiro — 1,5% de diferença, com 51 dos 74 dias tendo os dois eventos.
-- O recorte fica.
--
-- O ALVO É CAMPO, NÃO MEDIDA
--
-- `target` sai no payload lido de `goals` (org + mês do bounds; org-level salvo
-- filtro de membro). Isto NÃO porta `meta_definida` nem `meta_atingimento`: o
-- motor só compõe razão entre dois IDS DO CATÁLOGO, e alvo-como-campo não é id.
-- Transformar meta em medida é fatia própria, e depende de decisão de produto
-- sobre qual `goals.type` casa com qual medida (SCRUM-365).
--
-- ROLLBACK pareado: rollback/20270812120000_metric_reunioes_no_show.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('reunioes_no_show', 'Reuniões sem comparecimento registrado', 'count', 'fechamentos',
   'Marcadas menos comparecidas na janela (mínimo zero). Atenção: mede o REGISTRO — reunião realizada e não marcada como comparecida entra aqui.', 55)
ON CONFLICT (id) DO NOTHING;

-- O rótulo e a descrição acima corrigem a versão de 2026-07 ("Reuniões no-show",
-- "Reuniões marcadas que não compareceram"), que prometia comparecimento e
-- entregava registro. Se aquela linha já existir, o UPDATE abaixo a alinha —
-- catálogo é dado de SISTEMA, não de cliente (guarda F4 intacta).
UPDATE public.metric_catalog_measures
   SET label = 'Reuniões sem comparecimento registrado',
       description = 'Marcadas menos comparecidas na janela (mínimo zero). Atenção: mede o REGISTRO — reunião realizada e não marcada como comparecida entra aqui.'
 WHERE id = 'reunioes_no_show';

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('reunioes_no_show', 'total'),
  ('reunioes_no_show', 'sdr'),
  ('reunioes_no_show', 'origem'),
  ('reunioes_no_show', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('reunioes_no_show', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — COLUNA DE ALVO + MAPA (idempotente)
-- ===========================================================================
ALTER TABLE public.metric_catalog_measures ADD COLUMN IF NOT EXISTS goal_type text;

COMMENT ON COLUMN public.metric_catalog_measures.goal_type IS
  'type de public.goals que serve o ALVO desta medida. null = medida sem alvo. '
  'O motor lê goals.target_value da org + mês do bounds por este type.';

-- Mapa medido em prod: 'faturamento' é org-level e é o termômetro real;
-- 'reunioes_marcadas'/'reunioes_realizadas' batem por nome exato. `num_vendas`
-- fica NULL de propósito — o goal 'vendas' é meta de DINHEIRO por membro, não
-- contagem, e casá-lo com uma contagem inventaria um termômetro.
UPDATE public.metric_catalog_measures SET goal_type = 'faturamento'         WHERE id = 'receita'             AND goal_type IS NULL;
UPDATE public.metric_catalog_measures SET goal_type = 'reunioes_marcadas'   WHERE id = 'reunioes_marcadas'   AND goal_type IS NULL;
UPDATE public.metric_catalog_measures SET goal_type = 'reunioes_realizadas' WHERE id = 'reunioes_realizadas' AND goal_type IS NULL;

-- ===========================================================================
-- 3 — LEAF DE NO-SHOW
-- ===========================================================================
-- Porte fiel do corpo escrito em 20260727140000 — mesma aritmética, mesmas
-- âncoras (booked por occurred_at, held por COALESCE(meeting_date, occurred_at)),
-- mesmo clamp. Reescrito aqui só para a fatia não depender da ordem de apply.
CREATE OR REPLACE FUNCTION public._metric_leaf_no_show(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.meeting_events me
  LEFT JOIN public.leads l ON l.id = me.lead_id
  WHERE me.organization_id = p_org_id
    AND me.event_type IN ('meeting_booked','meeting_held')
    AND ((me.event_type = 'meeting_booked' AND me.occurred_at <@ p_bounds)
         OR (me.event_type = 'meeting_held'   AND COALESCE(me.meeting_date, me.occurred_at) <@ p_bounds))
    AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'));

  IF p_recorte = 'total' THEN
    SELECT GREATEST(
             count(*) FILTER (WHERE me.event_type = 'meeting_booked') -
             count(*) FILTER (WHERE me.event_type = 'meeting_held'), 0)
    INTO v_val
    FROM public.meeting_events me
    LEFT JOIN public.leads l ON l.id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type IN ('meeting_booked','meeting_held')
      AND ((me.event_type = 'meeting_booked' AND me.occurred_at <@ p_bounds)
           OR (me.event_type = 'meeting_held'   AND COALESCE(me.meeting_date, me.occurred_at) <@ p_bounds))
      AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'));

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  ELSE
    -- sdr | origem | tempo
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'sdr'   THEN (SELECT tm.name FROM public.team_members tm WHERE tm.id = g.bucket_key::uuid)
                 WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM')
                 ELSE g.bucket_key
               END,
               CASE p_recorte WHEN 'sdr' THEN 'Sem atribuição' ELSE 'Sem valor' END),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'sdr'    THEN me.pre_sale_responsible_id::text
          WHEN 'origem' THEN l.origin
          WHEN 'tempo'  THEN to_char(
            (CASE WHEN me.event_type = 'meeting_held'
                  THEN COALESCE(me.meeting_date, me.occurred_at) ELSE me.occurred_at END) AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        GREATEST(
          count(*) FILTER (WHERE me.event_type = 'meeting_booked') -
          count(*) FILTER (WHERE me.event_type = 'meeting_held'), 0) AS val
      FROM public.meeting_events me
      LEFT JOIN public.leads l ON l.id = me.lead_id
      WHERE me.organization_id = p_org_id
        AND me.event_type IN ('meeting_booked','meeting_held')
        AND ((me.event_type = 'meeting_booked' AND me.occurred_at <@ p_bounds)
             OR (me.event_type = 'meeting_held'   AND COALESCE(me.meeting_date, me.occurred_at) <@ p_bounds))
        AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY 1
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- ===========================================================================
-- 4 — DESPACHANTE: as 13 vigentes + no_show, e o alvo de volta
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
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
  END;

  -- A guarda que a versão de 2026-07 não tinha. Medida catalogada sem ramo
  -- devolveria value/series NULL em silêncio — número ausente lido como zero.
  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  -- ALVO: o motor LÊ goals — org + mês do bounds. Org-level salvo filtro de
  -- membro. Sem goal_type, ou sem bounds (snapshot 'hoje'), não há alvo.
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

-- ===========================================================================
-- 5 — GRANTS E GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) TO service_role;

DO $guard$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_fn   regprocedure;
  v_orfas text;
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

  -- O caminho da RECEITA é o que esta migration põe em risco ao reescrever o
  -- despachante. As duas leaves precisam continuar existindo.
  IF to_regprocedure('public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_sales sumiu — o caminho da receita quebrou';
  END IF;
  IF to_regprocedure('public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GUARDA: _metric_leaf_sales_lost sumiu — ganho/perda quebrou';
  END IF;

  -- TODA medida do catálogo tem de estar no CASE. É a checagem que a
  -- 20260727140000 não fez, e é exatamente por não a ter feito que este
  -- arquivo existe. `prosrc` do despachante é o texto do CASE; medida cujo id
  -- não aparece ali levanta 22023 na primeira abertura da janela.
  SELECT string_agg(m.id, ', ' ORDER BY m.id) INTO v_orfas
  FROM public.metric_catalog_measures m
  WHERE position('''' || m.id || '''' IN
        (SELECT p.prosrc FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = '_metric_leaf'
           AND p.pronargs = 8)) = 0;
  IF v_orfas IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida catalogada sem ramo no despachante: %', v_orfas;
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;

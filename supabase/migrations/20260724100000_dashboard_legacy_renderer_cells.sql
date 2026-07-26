-- 20260724100000_dashboard_legacy_renderer_cells.sql
--
-- ISSUE #1207 (épico #1194 · ADR-0023) — casca da TV, fatia DB 1/2.
-- Célula LEGADA RESERVADA dentro do grid.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ----------------------------
-- A spec §8.4.3 exige que os 2 congelados (CloserPerformanceBlock e o Thermometer
-- inline) vivam DENTRO do grid, como célula `pinned` com um id de renderer que o
-- motor reconhece mas NÃO avalia — sem medida, sem recorte. Se vivessem fora, a
-- parede teria dois sistemas de posicionamento e o Comando herdaria a bagunça;
-- matar o legado no v2 deixaria de ser "trocar um id" e viraria re-diagramar.
--
-- Só que `dashboard_widgets` (#1194, em prod) NÃO consegue gravar isso: measure_kind
-- é CHECK IN ('leaf','ratio'), recorte_id/format_id são NOT NULL, e kind_coherence
-- tem ELSE false — qualquer kind novo já é rejeitado. Célula reservada é impossível.
--
-- DECISÃO DO ARQUITETO (.specs/project/decisao-1207-celula-legada-e-semeadura.md):
-- `renderer_id` vai por FK a uma TABELA DE CATÁLOGO read-only — NÃO por allowlist
-- dentro do trigger. Allowlist hardcoded seria um SEGUNDO mecanismo, mais fraco,
-- para o mesmo trabalho: duas fontes do mesmo conjunto fechado, que divergem no
-- primeiro renderer novo. FK dá a mesma garantia de forma declarativa, mantém o
-- vocabulário fechado vivendo só em migration (ADR §2) e deixa o conjunto visível
-- para fn_metric_catalog() — de que o Composer precisa para NÃO oferecer renderer
-- legado como composível.
--
-- FRONTEIRA PRESERVADA (nota ao revisor): `renderer_id` é ID de catálogo fechado,
-- igual a measure_id/recorte_id/format_id. A regra do ADR — a composição só
-- referencia identificadores do catálogo, nunca SQL/tabela/coluna/organization_id —
-- fica INTOCADA. O invariante ZERO EXECUTE também: renderer_id nunca entra em SQL,
-- é resolvido no frontend para um componente legado.
--
-- ROLLBACK pareado: rollback/20260724100000_dashboard_legacy_renderer_cells.sql

-- ===========================================================================
-- 1. Catálogo de renderers (read-only, deny-all de escrita)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.metric_catalog_renderers (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  /* Renderer legado é célula RESERVADA: o motor não avalia medida para ela.
     Marcado explicitamente para o Composer poder filtrar o que é composível. */
  is_legacy   boolean NOT NULL DEFAULT false,
  sort        integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.metric_catalog_renderers IS
  'Catálogo fechado de renderers (#1207 / ADR-0023). Read-only via migration. '
  'Renderer legado = célula reservada no grid: o motor reconhece o id mas não '
  'avalia medida. Composer usa is_legacy para não oferecer como composível.';

INSERT INTO public.metric_catalog_renderers (id, label, description, is_legacy, sort) VALUES
  ('legacy:closer-performance', 'Desempenho por closer (legado)',
   'Célula reservada para CloserPerformanceBlock. Congelado na v1 (spec §8.4.1).', true, 10),
  ('legacy:thermometer',        'Termômetro de meta (legado)',
   'Célula reservada para o Thermometer inline de TVDashboard. Congelado na v1 — '
   'é ele que tem o marcador de ritmo, não o SalesThermometer órfão (spec §8.4.1).', true, 20)
ON CONFLICT (id) DO NOTHING;

-- RLS: SELECT liberado a authenticated, escrita SEM policy + REVOKE explícito.
-- (O ENABLE é load-bearing: sem ele a policy fica inerte e o deny-all passaria a
--  depender só do REVOKE. Foi exatamente o achado do Crivo na #1194.)
ALTER TABLE public.metric_catalog_renderers ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_catalog_renderers_select ON public.metric_catalog_renderers
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_renderers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.metric_catalog_renderers TO authenticated, anon;

-- ===========================================================================
-- 2. dashboard_widgets ganha renderer_id + campos de catálogo opcionais
-- ===========================================================================
ALTER TABLE public.dashboard_widgets
  ADD COLUMN IF NOT EXISTS renderer_id text
    REFERENCES public.metric_catalog_renderers(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.dashboard_widgets.renderer_id IS
  'Renderer de catálogo. Preenchido SÓ em measure_kind=''legacy'' (célula '
  'reservada, sem medida). NULL em leaf/ratio — simetria obrigatória: sem ela um '
  'leaf poderia carregar renderer e o snapshot ficaria ambíguo sobre qual caminho seguir.';

-- Célula legada não tem recorte nem formato.
ALTER TABLE public.dashboard_widgets ALTER COLUMN recorte_id DROP NOT NULL;
ALTER TABLE public.dashboard_widgets ALTER COLUMN format_id  DROP NOT NULL;

-- Vocabulário de kind ganha 'legacy'.
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_measure_kind_check;
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_measure_kind_check
  CHECK (measure_kind IN ('leaf','ratio','legacy'));

-- kind_coherence passa a ser o ÚNICO guardião de recorte_id/format_id (eles
-- deixaram de ser NOT NULL), então carrega isso EXPLICITAMENTE nos 3 ramos.
ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_kind_coherence;
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_kind_coherence CHECK (
    CASE measure_kind
      WHEN 'leaf' THEN
        measure_id IS NOT NULL AND num_measure_id IS NULL AND den_measure_id IS NULL
        AND recorte_id IS NOT NULL AND format_id IS NOT NULL AND renderer_id IS NULL
      WHEN 'ratio' THEN
        measure_id IS NULL AND num_measure_id IS NOT NULL AND den_measure_id IS NOT NULL
        AND recorte_id IS NOT NULL AND format_id IS NOT NULL AND renderer_id IS NULL
      WHEN 'legacy' THEN
        measure_id IS NULL AND num_measure_id IS NULL AND den_measure_id IS NULL
        AND recorte_id IS NULL AND format_id IS NULL AND renderer_id IS NOT NULL
      ELSE false   -- kind desconhecido continua rejeitado
    END
  );

-- ===========================================================================
-- 3. Trigger de validação — legacy pula as checagens de catálogo de medida
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.validate_widget_against_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_key text;
  v_hero_count int;
  v_widget_count int;
  v_allowed text[] := ARRAY['pipeline_id','member_id','origin','tag_id','product_id','stream'];
BEGIN
  -- (0) Gate de rollout.
  IF NOT public.fn_composable_metrics_enabled(NEW.organization_id) THEN
    RAISE EXCEPTION 'composable_metrics disabled for org %', NEW.organization_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (1) Compatibilidade com o catálogo de MEDIDA. Célula legada não tem medida:
  --     a fronteira dela é a FK de renderer_id (declarativa), não este trigger.
  IF NEW.measure_kind = 'leaf' THEN
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
                   WHERE measure_id = NEW.measure_id AND recorte_id = NEW.recorte_id) THEN
      RAISE EXCEPTION 'recorte % incompatible with measure %', NEW.recorte_id, NEW.measure_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_formats
                   WHERE measure_id = NEW.measure_id AND format_id = NEW.format_id) THEN
      RAISE EXCEPTION 'format % incompatible with measure %', NEW.format_id, NEW.measure_id
        USING ERRCODE = '23514';
    END IF;

  ELSIF NEW.measure_kind = 'ratio' THEN
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
                   WHERE measure_id = NEW.num_measure_id AND recorte_id = NEW.recorte_id) THEN
      RAISE EXCEPTION 'recorte % incompatible with num measure %', NEW.recorte_id, NEW.num_measure_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
                   WHERE measure_id = NEW.den_measure_id AND recorte_id = NEW.recorte_id) THEN
      RAISE EXCEPTION 'recorte % incompatible with den measure %', NEW.recorte_id, NEW.den_measure_id
        USING ERRCODE = '23514';
    END IF;

  ELSIF NEW.measure_kind <> 'legacy' THEN
    -- Defesa: kind fora do vocabulário não chega aqui (CHECK barra antes), mas se
    -- alguém afrouxar o CHECK, o trigger não passa a aceitar em silêncio.
    RAISE EXCEPTION 'unknown measure_kind %', NEW.measure_kind USING ERRCODE = '23514';
  END IF;

  -- (2) filters: só chaves da allowlist, e NUNCA organization_id. Vale para os 3 kinds.
  IF NEW.filters IS NOT NULL AND jsonb_typeof(NEW.filters) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(NEW.filters) LOOP
      IF v_key = 'organization_id' THEN
        RAISE EXCEPTION 'filters must never contain organization_id' USING ERRCODE = '23514';
      END IF;
      IF NOT (v_key = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'filter key % not in allowlist (%)', v_key, array_to_string(v_allowed, ',')
          USING ERRCODE = '23514';
      END IF;
      IF v_key IN ('pipeline_id','member_id','tag_id','product_id') THEN
        BEGIN
          PERFORM (NEW.filters->>v_key)::uuid;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'filter % must be a uuid', v_key USING ERRCODE = '23514';
        END;
      END IF;
    END LOOP;
  ELSIF NEW.filters IS NOT NULL AND jsonb_typeof(NEW.filters) <> 'object' THEN
    RAISE EXCEPTION 'filters must be a json object' USING ERRCODE = '23514';
  END IF;

  -- (3) Máx 1 hero/página.
  IF NEW.weight = 'hero' THEN
    SELECT count(*) INTO v_hero_count FROM public.dashboard_widgets
    WHERE page_id = NEW.page_id AND weight = 'hero' AND id <> NEW.id;
    IF v_hero_count >= 1 THEN
      RAISE EXCEPTION 'page % already has a hero widget', NEW.page_id USING ERRCODE = '23514';
    END IF;
  END IF;

  -- (4) Teto de 12 widgets/página (§6.4). O teto de 8 dispara por TIPOGRAFIA
  --     (--tv-hero), não por tamanho de célula, e é aplicado na casca.
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_widget_count FROM public.dashboard_widgets WHERE page_id = NEW.page_id;
    IF v_widget_count >= 12 THEN
      RAISE EXCEPTION 'page % already has 12 widgets (max)', NEW.page_id USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 4. fn_metric_catalog() passa a servir os renderers
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_metric_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT jsonb_build_object(
    'measures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'label', m.label, 'unit', m.unit, 'anchor', m.anchor,
        'description', m.description,
        'compatible_recortes', COALESCE((
          SELECT jsonb_agg(mr.recorte_id ORDER BY r.sort)
          FROM public.metric_catalog_measure_recortes mr
          JOIN public.metric_catalog_recortes r ON r.id = mr.recorte_id
          WHERE mr.measure_id = m.id), '[]'::jsonb),
        'compatible_formats', COALESCE((
          SELECT jsonb_agg(mf.format_id ORDER BY f.sort)
          FROM public.metric_catalog_measure_formats mf
          JOIN public.metric_catalog_formats f ON f.id = mf.format_id
          WHERE mf.measure_id = m.id), '[]'::jsonb)
      ) ORDER BY m.sort)
      FROM public.metric_catalog_measures m), '[]'::jsonb),
    'recortes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label) ORDER BY r.sort)
      FROM public.metric_catalog_recortes r), '[]'::jsonb),
    'formats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) ORDER BY f.sort)
      FROM public.metric_catalog_formats f), '[]'::jsonb),
    'ratios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ra.id, 'label', ra.label,
        'num', ra.num_measure_id, 'den', ra.den_measure_id, 'format', ra.format_id,
        'unit', CASE
          WHEN mn.unit = 'count'    AND md.unit = 'count' THEN 'percent'
          WHEN mn.unit = 'currency' AND md.unit = 'count' THEN 'currency'
          ELSE 'ratio' END
      ) ORDER BY ra.sort)
      FROM public.metric_catalog_ratios ra
      JOIN public.metric_catalog_measures mn ON mn.id = ra.num_measure_id
      JOIN public.metric_catalog_measures md ON md.id = ra.den_measure_id), '[]'::jsonb),
    -- Renderers: o Composer usa is_legacy para NÃO oferecer célula reservada
    -- como composível.
    'renderers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rd.id, 'label', rd.label, 'description', rd.description, 'is_legacy', rd.is_legacy
      ) ORDER BY rd.sort)
      FROM public.metric_catalog_renderers rd), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- 5. fn_dashboard_snapshot — emite célula legada SEM chamar o motor
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_dashboard_snapshot(
  p_org_id  uuid,
  p_page_id uuid,
  p_period  text  DEFAULT 'month',
  p_ref     date  DEFAULT NULL,
  p_start   date  DEFAULT NULL,
  p_end     date  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_widgets jsonb := '[]'::jsonb;
  v_one jsonb;
  v_ref jsonb;
  r RECORD;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RETURN jsonb_build_object('disabled', true, 'page_id', p_page_id, 'widgets', '[]'::jsonb);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.dashboard_pages dp
                 WHERE dp.id = p_page_id AND dp.organization_id = p_org_id) THEN
    RAISE EXCEPTION 'page % not found for org %', p_page_id, p_org_id USING ERRCODE = 'P0002';
  END IF;

  FOR r IN
    SELECT w.id, w.measure_kind, w.measure_id, w.num_measure_id, w.den_measure_id,
           w.recorte_id, w.format_id, w.filters, w.weight, w.eyebrow_override,
           w.grid_col, w.grid_row, w.grid_w, w.grid_h, w.pinned, w.position, w.renderer_id
    FROM public.dashboard_widgets w
    WHERE w.organization_id = p_org_id AND w.page_id = p_page_id
    ORDER BY w.position, w.id
    LIMIT 12
  LOOP
    BEGIN
      IF r.measure_kind = 'legacy' THEN
        -- Célula RESERVADA: o motor reconhece o id mas NÃO avalia. Sem medida,
        -- sem recorte, sem chamada a fn_metric_measure. O front resolve o
        -- renderer_id para o componente legado.
        v_one := NULL;
      ELSE
        v_ref := CASE r.measure_kind
          WHEN 'ratio' THEN jsonb_build_object('kind','ratio','num',r.num_measure_id,'den',r.den_measure_id)
          ELSE jsonb_build_object('kind','leaf','id',r.measure_id)
        END;
        v_one := public.fn_metric_measure(
                   p_org_id, v_ref, r.recorte_id, p_period, p_ref, p_start, p_end,
                   COALESCE(r.filters, '{}'::jsonb));
      END IF;

      v_widgets := v_widgets || jsonb_build_object(
        'widget_id', r.id,
        'measure_kind', r.measure_kind,
        'renderer_id', r.renderer_id,
        'weight', r.weight,
        'format_id', r.format_id,
        'recorte_id', r.recorte_id,
        'eyebrow_override', r.eyebrow_override,
        'grid', jsonb_build_object('col', r.grid_col, 'row', r.grid_row, 'w', r.grid_w, 'h', r.grid_h),
        'pinned', r.pinned,
        'filters', COALESCE(r.filters, '{}'::jsonb),
        'measure', v_one
      );
    EXCEPTION WHEN OTHERS THEN
      v_widgets := v_widgets || jsonb_build_object('widget_id', r.id, 'error', 'unavailable');
    END;
  END LOOP;

  RETURN jsonb_build_object('disabled', false, 'page_id', p_page_id, 'widgets', v_widgets);
END;
$$;

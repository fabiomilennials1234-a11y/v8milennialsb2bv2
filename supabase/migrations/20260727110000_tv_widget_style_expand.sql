-- 20260727110000_tv_widget_style_expand.sql
--
-- ISSUE #1253 (S1, épico #1194 · ADR-0023) — TV vivacidade, fatia 1: FUNDAÇÃO.
-- Área frágil (multi-tenant: cliente escreve a própria parede). Crivo bloqueante.
--
-- POR QUÊ — a parede da Milennials tem 4 células `legacy:*` renderizando frame +
-- `—` SEM corpo (#1219 nunca construída); e Line/Donut morrem por "derivação sem
-- escolha". O alvo (decisão CTO 2026-07-26) é a vivacidade do mockup ff96. Esta
-- fatia entrega o SCHEMA que separa as 3 dimensões que o Vitral nomeou (§1.2):
--   • formatação de número (value_format) — deriva de measure.unit
--   • estilo visual        (widget_style)  — cliente escolhe; null → derivado
--   • cor de identidade    (accent_hue)    — cliente escolhe; null → default
--
-- EXPAND/CONTRACT (ratificação CTO — NÃO rename seco de format_id → value_format):
-- merge em main = deploy de front automático (EasyPanel :latest); migration =
-- manual; não-atômicos e sem ambiente de validação. Rename seco quebra a TV em
-- QUALQUER ordem. Então:
--   • (expand, ESTA fatia) ADD value_format + backfill de format_id + dual-sync
--     (trigger mantém os dois iguais). Código lê `value_format ?? format_id`,
--     escreve nos DOIS. Janela de quebra = zero.
--   • (contract, S7, fatia separada, prod estável) DROP format_id.
-- `format_id` fica INTACTO aqui.
--
-- Novas tabelas de catálogo de estilo: read-only, deny-all de escrita, semeadas
-- por migration (padrão #1194/#1207 — vocabulário fechado vive só em migration).
--
-- NÃO cobre (fatias próprias): a compatibilidade widget_style ∈ styles(measure) na
-- ESCRITA é do write-path (S3); o canal visual de accent_hue no WidgetFrame é S6.
-- Aqui só o SCHEMA + o snapshot passa a EMITIR os campos (o front os consome já).
--
-- ADITIVA. Inerte até o re-seed (fatia irmã) e o front usarem. ROLLBACK pareado:
-- rollback/20260727110000_tv_widget_style_expand.sql

-- ===========================================================================
-- 1. metric_catalog_widget_styles — os 7 formatos visuais (read-only, deny-all)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.metric_catalog_widget_styles (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  sort        integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.metric_catalog_widget_styles IS
  'Catálogo fechado dos 7 formatos visuais da TV (#1253 / ADR-0023). Read-only '
  'via migration. widget_style ?? deriveStyle(measure, recorte) — Vitral §1.2.';

INSERT INTO public.metric_catalog_widget_styles (id, label, description, sort) VALUES
  ('number',   'Número',    'Valor de cabeça, sem corpo. Param: trend (sparkline).',        10),
  ('line',     'Linha',     'Série temporal. Param: full | spark.',                          20),
  ('bar',      'Barra',     'Categorias ordenadas, rótulo+valor no fim. Param: identity.',   30),
  ('ranking',  'Ranking',   'Pessoas ordenadas com identidade. Param: podium | list.',       40),
  ('progress', 'Progresso', 'Valor ÷ alvo com pace/delta. Param: gauge tube|bar|radial.',    50),
  ('donut',    'Donut',     'Composição ≥2 categorias, total no centro.',                    60),
  ('funnel',   'Funil',     'Etapas + taxa entre etapas. Param: bars | trapezoid.',          70)
ON CONFLICT (id) DO NOTHING;

-- RLS: ENABLE é load-bearing (sem ele a policy fica inerte — achado do Crivo #1194).
ALTER TABLE public.metric_catalog_widget_styles ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_catalog_widget_styles_select ON public.metric_catalog_widget_styles
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_widget_styles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.metric_catalog_widget_styles TO authenticated, anon;

-- ===========================================================================
-- 2. metric_catalog_style_variants — o PARÂMETRO por estilo (conjunto fechado)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.metric_catalog_style_variants (
  style_id  text NOT NULL REFERENCES public.metric_catalog_widget_styles(id) ON DELETE CASCADE,
  variant   text NOT NULL,
  label     text NOT NULL,
  sort      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (style_id, variant)
);
COMMENT ON TABLE public.metric_catalog_style_variants IS
  'Variants por estilo (#1253). PK (style_id, variant) é o alvo do FK composto de '
  'dashboard_widgets(widget_style, style_variant). Conjunto fechado (não jsonb).';

INSERT INTO public.metric_catalog_style_variants (style_id, variant, label, sort) VALUES
  ('number',   'plain',     'Número',        10),
  ('number',   'trend',     'Com tendência', 20),
  ('line',     'full',      'Completa',      10),
  ('line',     'spark',     'Mini',          20),
  ('bar',      'plain',     'Barra',         10),
  ('bar',      'identity',  'Com identidade',20),
  ('ranking',  'podium',    'Pódio',         10),
  ('ranking',  'list',      'Lista',         20),
  ('progress', 'tube',      'Termômetro',    10),
  ('progress', 'bar',       'Barra',         20),
  ('progress', 'radial',    'Velocímetro',   30),
  ('donut',    'plain',     'Donut',         10),
  ('funnel',   'bars',      'Barras',        10),
  ('funnel',   'trapezoid', 'Trapézio',      20)
ON CONFLICT (style_id, variant) DO NOTHING;

ALTER TABLE public.metric_catalog_style_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_catalog_style_variants_select ON public.metric_catalog_style_variants
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_style_variants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.metric_catalog_style_variants TO authenticated, anon;

-- ===========================================================================
-- 3. metric_catalog_measure_styles — estilos compatíveis por medida
-- ===========================================================================
-- Usado pela galeria (S4) e pela validação de escrita (S3). Semeado data-driven
-- para não codificar a lista de medidas: todas as medidas aceitam os estilos
-- gerais; funnel só faz sentido com ordenação de etapa (leads_na_etapa). A
-- matriz fina é refinada no S4 — aqui é um default defensável, não o produto.
CREATE TABLE IF NOT EXISTS public.metric_catalog_measure_styles (
  measure_id text NOT NULL REFERENCES public.metric_catalog_measures(id) ON DELETE CASCADE,
  style_id   text NOT NULL REFERENCES public.metric_catalog_widget_styles(id) ON DELETE CASCADE,
  PRIMARY KEY (measure_id, style_id)
);
COMMENT ON TABLE public.metric_catalog_measure_styles IS
  'Estilos compatíveis por medida (#1253). Galeria (S4) só oferece o compatível; '
  'incompatível é ausente, nunca erro. Default data-driven; refinado no S4.';

-- Estilos gerais (todo measure): number, line, bar, ranking, donut, progress.
INSERT INTO public.metric_catalog_measure_styles (measure_id, style_id)
  SELECT m.id, s.id
  FROM public.metric_catalog_measures m
  CROSS JOIN public.metric_catalog_widget_styles s
  WHERE s.id <> 'funnel'
ON CONFLICT (measure_id, style_id) DO NOTHING;

-- Funil: só medida com semântica de etapa ordenada.
INSERT INTO public.metric_catalog_measure_styles (measure_id, style_id)
  SELECT m.id, 'funnel'
  FROM public.metric_catalog_measures m
  WHERE m.id = 'leads_na_etapa'
ON CONFLICT (measure_id, style_id) DO NOTHING;

ALTER TABLE public.metric_catalog_measure_styles ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_catalog_measure_styles_select ON public.metric_catalog_measure_styles
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_measure_styles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.metric_catalog_measure_styles TO authenticated, anon;

-- ===========================================================================
-- 4. dashboard_widgets — as 3 dimensões novas + value_format (expand)
-- ===========================================================================
ALTER TABLE public.dashboard_widgets
  ADD COLUMN IF NOT EXISTS value_format  text REFERENCES public.metric_catalog_formats(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS widget_style  text REFERENCES public.metric_catalog_widget_styles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS style_variant text,
  ADD COLUMN IF NOT EXISTS accent_hue    text;

COMMENT ON COLUMN public.dashboard_widgets.value_format IS
  'Formatação de número (#1253, EXPAND de format_id). Dual-sync com format_id via '
  'trigger enquanto durar o expand; código lê value_format ?? format_id. DROP de '
  'format_id é o S7.';
COMMENT ON COLUMN public.dashboard_widgets.widget_style IS
  'Estilo visual escolhido (#1253). null → derivado (resolveChartType). FK ao '
  'catálogo fechado. Compatibilidade com a medida é validada na escrita no S3.';
COMMENT ON COLUMN public.dashboard_widgets.accent_hue IS
  'Cor de identidade no canal gráfico (#1253). null → default por medida. O canal '
  'visual no WidgetFrame é o S6; aqui só a coluna.';

-- style_variant validado por FK COMPOSTO (widget_style, style_variant) →
-- style_variants(style_id, variant). MATCH SIMPLE: se style_variant é null, não
-- checa (variant default). style_variant sem style é incoerente → CHECK.
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_style_variant_fk
  FOREIGN KEY (widget_style, style_variant)
  REFERENCES public.metric_catalog_style_variants (style_id, variant) ON DELETE RESTRICT;

ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_style_variant_needs_style
  CHECK (style_variant IS NULL OR widget_style IS NOT NULL);

-- accent_hue: entrada da paleta §2.5 (§3.2) — zero token novo. Conjunto fechado.
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_accent_hue_check
  CHECK (accent_hue IS NULL OR accent_hue IN (
    'chart-1','chart-2','chart-3','chart-4','chart-5',
    'ramp-1','ramp-2','ramp-3','ramp-4','ramp-5'
  ));

-- Backfill: value_format = format_id nas linhas existentes (legacy tem format_id
-- null → value_format fica null, coerente).
UPDATE public.dashboard_widgets
   SET value_format = format_id
 WHERE value_format IS NULL AND format_id IS NOT NULL;

-- ===========================================================================
-- 5. Dual-sync value_format ⇆ format_id (BEFORE, roda ANTES da validação)
-- ===========================================================================
-- Mantém os dois iguais enquanto durar o expand. Nome trg_aa_* garante ordem
-- alfabética antes de trg_validate_widget_against_catalog (que checa format_id).
-- value_format vence se ambos vierem; senão espelha o que veio. Legacy (ambos
-- null) fica null — coerente com kind_coherence.
CREATE OR REPLACE FUNCTION public.fn_sync_widget_value_format()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  NEW.format_id    := COALESCE(NEW.value_format, NEW.format_id);
  NEW.value_format := NEW.format_id;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.fn_sync_widget_value_format() IS
  'Dual-sync value_format ⇆ format_id (#1253 expand). Mantém os dois iguais até o '
  'DROP de format_id no S7. Roda antes da validação de catálogo (trg_aa_*).';

DROP TRIGGER IF EXISTS trg_aa_dashboard_widgets_value_format_sync ON public.dashboard_widgets;
CREATE TRIGGER trg_aa_dashboard_widgets_value_format_sync
  BEFORE INSERT OR UPDATE ON public.dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_widget_value_format();

-- ===========================================================================
-- 6. fn_dashboard_snapshot — passa a EMITIR os campos de estilo
-- ===========================================================================
-- OR REPLACE do corpo de 20260724100000: adiciona widget_style, style_variant,
-- accent_hue e value_format à seleção e à saída. O front escolhe o renderer por
-- widget_style (?? deriva), sem mudar a semântica do resto.
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
           w.recorte_id, w.format_id, w.value_format, w.widget_style, w.style_variant,
           w.accent_hue, w.filters, w.weight, w.eyebrow_override,
           w.grid_col, w.grid_row, w.grid_w, w.grid_h, w.pinned, w.position, w.renderer_id
    FROM public.dashboard_widgets w
    WHERE w.organization_id = p_org_id AND w.page_id = p_page_id
    ORDER BY w.position, w.id
    LIMIT 12
  LOOP
    BEGIN
      IF r.measure_kind = 'legacy' THEN
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
        'value_format', COALESCE(r.value_format, r.format_id),
        'widget_style', r.widget_style,
        'style_variant', r.style_variant,
        'accent_hue', r.accent_hue,
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

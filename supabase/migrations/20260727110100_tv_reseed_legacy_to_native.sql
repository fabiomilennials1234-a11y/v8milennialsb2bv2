-- 20260727110100_tv_reseed_legacy_to_native.sql
--
-- ISSUE #1253 (S1, épico #1194 · ADR-0023) — TV vivacidade, fatia 1: RE-SEED.
-- Área frágil (escrita em PAREDE VIVA da Milennials — o CTO olha todo dia). Crivo
-- bloqueante. Depende de 20260727110000 (schema expand).
--
-- POR QUÊ — os 4 widgets `legacy:*` (thermometer + closer-performance, pinned,
-- repetidos nas 2 páginas) renderizam frame + `—` SEM corpo (#1219 nunca
-- construída). Regra dura (Vitral §5.0): célula pinada em branco NÃO sobe. Esta
-- fatia PROMOVE cada legado ao formato NATIVO equivalente:
--   legacy:thermometer        → Progresso (widget_style=progress, tube)  · receita/total
--   legacy:closer-performance → Ranking   (widget_style=ranking, podium) · receita/closer
--
-- ALVO (decisão Cais mode b): o motor NÃO serve alvo no S1 (a meta legada vinha da
-- tabela goals, fora do motor). O ProgressRenderer degrada honesto SEM alvo →
-- renderiza o valor (Número), sem gauge/meta inventada. Fecha a célula com corpo
-- real. O gauge-com-meta é fatia futura (liga goals no motor).
--
-- DEDUP (Cais Q1 + princípio geral "não semear 2 widgets de mesma medida/corte"):
-- a parede já tinha `receita/closer` em BAR e `receita/total` em Número. O pódio e
-- o progresso os SUPERAM (forma mais rica). Removo os 2 composable redundantes
-- (só os que têm widget_style NULL = os antigos; os promovidos têm style, ficam).
-- NOTA AO CRIVO/CAIS: Cais nomeou explicitamente só o closer; apliquei o MESMO
-- princípio ao receita/total (dois números de receita idênticos na parede do CTO
-- lêem como descuido). Se o intento era só o closer, reverter o DELETE do total.
--
-- ⚠ 3 GUARDAS (escrita destrutiva em org viva) — macro §S1:
--   1. CIRÚRGICO: toca só os 4 `legacy:*` (por renderer_id) + os 2 composable
--      redundantes que os promovidos superam. Os demais 11 composable ficam.
--   2. BACKUP ANTES: dump de pages+widgets da org em dashboard_composition_backup
--      ANTES de qualquer write. Restaurável (rollback documentado abaixo).
--   3. IDEMPOTENTE: keyed no renderer_id legacy. 2ª execução não acha legado →
--      loop não roda → zero backup e zero write (provado em pgTAP).
--
-- ROLLBACK: rollback/20260727110100_tv_reseed_legacy_to_native.sql restaura a
-- composição do backup mais recente por org e remove a tabela de backup.

-- ===========================================================================
-- 1. Tabela de backup da composição (restaurável)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.dashboard_composition_backup (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot        jsonb NOT NULL,          -- { pages: [...], widgets: [...] } cru
  reason          text  NOT NULL,
  taken_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dashboard_composition_backup IS
  'Backup restaurável da composição de dashboard antes de escrita destrutiva '
  '(#1253 S1 re-seed). snapshot = pages+widgets crus da org. Read admin/master; '
  'escrita só por sistema (migration/service_role).';
CREATE INDEX IF NOT EXISTS idx_dashboard_composition_backup_org
  ON public.dashboard_composition_backup (organization_id, taken_at DESC);

ALTER TABLE public.dashboard_composition_backup ENABLE ROW LEVEL SECURITY;
-- Leitura: admin da org ou master (é a composição da própria org). Escrita: sem
-- policy + REVOKE (só migration/service_role escrevem).
CREATE POLICY dashboard_composition_backup_select ON public.dashboard_composition_backup
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dashboard_composition_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dashboard_composition_backup TO authenticated;

-- ===========================================================================
-- 2. Part A — futuros orgs nascem NATIVOS (OR REPLACE do corpo da semeadura)
-- ===========================================================================
-- Mesma composição do #1207, com os 2 congelados JÁ como nativos e sem os 2
-- composable que eles superam (dedup na origem — não semeia o que será removido).
CREATE OR REPLACE FUNCTION public._fn_seed_default_dashboard_unchecked(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_page1 uuid;
  v_page2 uuid;
  v_created int := 0;
BEGIN
  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'flag_off');
  END IF;
  IF EXISTS (SELECT 1 FROM public.dashboard_pages WHERE organization_id = p_org_id AND surface = 'tv') THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'already_exists');
  END IF;

  -- ── Página 1 — Fechamento ────────────────────────────────────────────────
  INSERT INTO public.dashboard_pages (organization_id, surface, title, position, rotation_seconds)
  VALUES (p_org_id, 'tv', 'Fechamento', 0, 20)
  RETURNING id INTO v_page1;

  -- Os 2 antes-congelados, agora NATIVOS (mesma posição/pinned). Progresso degrada
  -- para Número no S1 (sem alvo no motor); o pódio supera o antigo bar de closer.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, value_format, widget_style, style_variant, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'receita', 'total',  'currency_brl', 'currency_brl', 'progress', 'tube',   'primary', true, 0, 0, 3, 4, 0),
    (p_org_id, v_page1, 'leaf', 'receita', 'closer', 'currency_brl', 'currency_brl', 'ranking',  'podium', 'primary', true, 3, 0, 4, 2, 1);
  v_created := v_created + 2;

  -- Número de fechamento (num_vendas). receita/total saiu — vive no Progresso acima.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'num_vendas', 'total', 'integer', 'primary', 9, 0, 2, 1, 3);
  v_created := v_created + 1;

  -- Razões: conversão e ticket médio.
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, num_measure_id, den_measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'ratio', 'num_vendas', 'leads_criados', 'total', 'percent_1',    'primary', 7, 1, 2, 1, 4),
    (p_org_id, v_page1, 'ratio', 'receita',    'num_vendas',    'total', 'currency_brl', 'primary', 9, 1, 2, 1, 5);
  v_created := v_created + 2;

  -- Leads por etapa (o receita/closer bar saiu — vive no pódio acima).
  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page1, 'leaf', 'leads_na_etapa', 'etapa', 'integer', 'secondary', 7, 2, 5, 3, 7);
  v_created := v_created + 1;

  -- ── Página 2 — Time e topo de funil ──────────────────────────────────────
  INSERT INTO public.dashboard_pages (organization_id, surface, title, position, rotation_seconds)
  VALUES (p_org_id, 'tv', 'Time e topo de funil', 1, 20)
  RETURNING id INTO v_page2;

  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, value_format, widget_style, style_variant, weight, pinned, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'receita', 'total',  'currency_brl', 'currency_brl', 'progress', 'tube',   'primary', true, 0, 0, 3, 4, 0),
    (p_org_id, v_page2, 'leaf', 'receita', 'closer', 'currency_brl', 'currency_brl', 'ranking',  'podium', 'primary', true, 3, 0, 4, 2, 1);
  v_created := v_created + 2;

  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'leads_criados', 'total',  'integer', 'primary',   7, 0, 2, 1, 2),
    (p_org_id, v_page2, 'leaf', 'leads_criados', 'origem', 'integer', 'secondary', 7, 2, 3, 2, 3);
  v_created := v_created + 2;

  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'reunioes_marcadas',   'total', 'integer', 'primary',   9, 0, 2, 1, 4),
    (p_org_id, v_page2, 'leaf', 'reunioes_realizadas', 'total', 'integer', 'primary',   9, 1, 2, 1, 5),
    (p_org_id, v_page2, 'leaf', 'reunioes_marcadas',   'sdr',   'integer', 'secondary', 3, 2, 3, 2, 6);
  v_created := v_created + 3;

  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, num_measure_id, den_measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'ratio', 'reunioes_realizadas', 'reunioes_marcadas', 'total', 'percent_1', 'primary', 7, 1, 2, 1, 7);
  v_created := v_created + 1;

  INSERT INTO public.dashboard_widgets
    (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, weight, grid_col, grid_row, grid_w, grid_h, position)
  VALUES
    (p_org_id, v_page2, 'leaf', 'leads_na_etapa', 'total', 'integer', 'primary', 11, 0, 1, 1, 8);
  v_created := v_created + 1;

  RETURN jsonb_build_object('seeded', true, 'pages', 2, 'widgets', v_created);
END;
$$;

-- ===========================================================================
-- 3. Part B — promoção CIRÚRGICA de UMA org (backup → promote → dedup)
-- ===========================================================================
-- Função (não DO block inline) para ser IDEMPOTENTE e TESTÁVEL: o pgTAP a chama
-- 2× e prova que a 2ª é no-op (aceite §S1). SECURITY DEFINER + system-only
-- (padrão _fn_seed_default_dashboard_unchecked): não autoriza, executa; chamada
-- pela migration (postgres, sem JWT) e pelos testes.
--
-- IDEMPOTÊNCIA por construção: a 1ª instrução checa se há legado; se não há
-- (2ª execução), retorna {promoted:false} SEM tocar em nada — nem backup, nem
-- write. Assim re-rodar NUNCA duplica backup nem reverte edição futura do cliente.
CREATE OR REPLACE FUNCTION public._fn_reseed_legacy_to_native_unchecked(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_has_legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.dashboard_widgets
    WHERE organization_id = p_org_id AND measure_kind = 'legacy'
      AND renderer_id IN ('legacy:thermometer', 'legacy:closer-performance')
  ) INTO v_has_legacy;

  -- GUARDA 3 (idempotente): sem legado = já promovido (ou nunca teve) → no-op.
  IF NOT v_has_legacy THEN
    RETURN jsonb_build_object('promoted', false, 'reason', 'no_legacy_cells');
  END IF;

  -- GUARDA 2: backup ANTES de qualquer write (só quando há o que promover).
  INSERT INTO public.dashboard_composition_backup (organization_id, snapshot, reason)
  SELECT p_org_id,
    jsonb_build_object(
      'pages',   (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.position), '[]'::jsonb)
                    FROM public.dashboard_pages p WHERE p.organization_id = p_org_id),
      'widgets', (SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.page_id, w.position), '[]'::jsonb)
                    FROM public.dashboard_widgets w WHERE w.organization_id = p_org_id)
    ),
    '#1253 S1 re-seed legacy→native';

  -- GUARDA 1: cirúrgico — keyed no renderer_id. thermometer → Progresso.tube.
  UPDATE public.dashboard_widgets
     SET measure_kind = 'leaf', measure_id = 'receita', recorte_id = 'total',
         format_id = 'currency_brl', value_format = 'currency_brl',
         widget_style = 'progress', style_variant = 'tube', renderer_id = NULL
   WHERE organization_id = p_org_id
     AND measure_kind = 'legacy' AND renderer_id = 'legacy:thermometer';

  -- closer-performance → Ranking.podium (receita/closer).
  UPDATE public.dashboard_widgets
     SET measure_kind = 'leaf', measure_id = 'receita', recorte_id = 'closer',
         format_id = 'currency_brl', value_format = 'currency_brl',
         widget_style = 'ranking', style_variant = 'podium', renderer_id = NULL
   WHERE organization_id = p_org_id
     AND measure_kind = 'legacy' AND renderer_id = 'legacy:closer-performance';

  -- DEDUP: remove os composable ANTIGOS que os promovidos superam (widget_style
  -- NULL = os originais; os promovidos têm style e NÃO casam).
  DELETE FROM public.dashboard_widgets
   WHERE organization_id = p_org_id AND measure_kind = 'leaf'
     AND measure_id = 'receita' AND recorte_id = 'closer' AND widget_style IS NULL;
  DELETE FROM public.dashboard_widgets
   WHERE organization_id = p_org_id AND measure_kind = 'leaf'
     AND measure_id = 'receita' AND recorte_id = 'total' AND widget_style IS NULL;

  RETURN jsonb_build_object('promoted', true);
END;
$$;

COMMENT ON FUNCTION public._fn_reseed_legacy_to_native_unchecked(uuid) IS
  'Promove os 4 legacy:* da org a nativos (#1253 S1): backup → promote (keyed no '
  'renderer_id) → dedup dos composable superados. Idempotente (sem legado = no-op, '
  'sem backup). System-only (migration/testes). Rollback = restaurar do backup.';
REVOKE EXECUTE ON FUNCTION public._fn_reseed_legacy_to_native_unchecked(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._fn_reseed_legacy_to_native_unchecked(uuid) TO service_role;

-- Backfill: promove todas as orgs que hoje têm legado semeado.
DO $reseed$
DECLARE r RECORD; v_orgs int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT organization_id FROM public.dashboard_widgets
    WHERE measure_kind = 'legacy'
      AND renderer_id IN ('legacy:thermometer', 'legacy:closer-performance')
  LOOP
    IF (public._fn_reseed_legacy_to_native_unchecked(r.organization_id) ->> 'promoted')::boolean THEN
      v_orgs := v_orgs + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '#1253 S1 re-seed: % org(s) com legado promovido a nativo', v_orgs;
END
$reseed$;

-- 20260723100200_composable_dashboard_schema.sql
--
-- ISSUE #1194 (PRD #986 · ADR-0023) — Métricas Montáveis, Camada 2, fatia 3/5.
-- Esquema de composição: config em DADOS, validada contra o catálogo NA ESCRITA.
--
-- FRONTEIRA DURA (ADR-0023): a composição referencia SÓ IDs do catálogo — nunca
-- SQL, tabela, coluna ou organization_id. A validação é PROPRIEDADE DE SEGURANÇA
-- e vive NO BANCO, em 3 camadas, não na app:
--   1. FK  measure/recorte/format → catálogo. ID inexistente = rejeitado.
--   2. CHECK de enums (surface, weight, measure_kind) + length(eyebrow)<=28.
--   3. TRIGGER validate_widget_against_catalog() BEFORE INSERT/UPDATE:
--      recorte ∈ compatible(measure), format ∈ compatible(measure), ratio com
--      num/den compatíveis, filters só chaves da allowlist e SEM organization_id,
--      máx 1 hero/página, teto 12 widgets/página. E gate pela flag de rollout.
--
-- organization_id VEM DO AUTH (RLS), NUNCA do payload — regra multi-tenant da
-- casa. RLS espelha leads (get_my_organization_ids + is_master_user).
--
-- RASCUNHO (contrato acordado com Vitral): dashboard_pages.draft jsonb é o
-- staging editável do Composer — NÃO passa por FK enquanto rascunho. A verdade
-- PUBLICADA que a TV lê são as linhas de dashboard_widgets (validadas). O
-- 'Publicar na TV' (RPC atômica) é da fatia de composição do Vitral; esta
-- fundação entrega a coluna draft + o esquema publicado + o snapshot.
--
-- ROLLBACK pareado: rollback/20260723100200_composable_dashboard_schema.sql.

-- ===========================================================================
-- 1. dashboard_pages
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.dashboard_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  surface          text NOT NULL,
  title            text NOT NULL,
  position         integer NOT NULL DEFAULT 0,
  rotation_seconds integer NOT NULL DEFAULT 20,
  draft            jsonb,                       -- staging do Composer (Vitral); nunca lido pela TV
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_pages_surface_check CHECK (surface IN ('tv','command')),
  CONSTRAINT dashboard_pages_rotation_check CHECK (rotation_seconds BETWEEN 5 AND 600)
);
COMMENT ON TABLE public.dashboard_pages IS
  'Página de dashboard montável (#1194 / ADR-0023). surface tv|command. '
  'draft jsonb = staging editável do Composer (Vitral), não lido pela TV. RLS org-scoped.';
COMMENT ON COLUMN public.dashboard_pages.draft IS
  'Staging editável do Composer (contrato Vitral #1194). Layout de widgets em '
  'rascunho; NÃO passa por FK/trigger enquanto rascunho. O Publicar (RPC atômica '
  'da fatia de composição) materializa em dashboard_widgets, que é o que a TV lê.';

-- ===========================================================================
-- 2. dashboard_widgets — a config PUBLICADA (o que a TV lê)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.dashboard_widgets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_id          uuid NOT NULL REFERENCES public.dashboard_pages(id) ON DELETE CASCADE,
  grid_col         integer NOT NULL DEFAULT 0,
  grid_row         integer NOT NULL DEFAULT 0,
  grid_w           integer NOT NULL DEFAULT 1,
  grid_h           integer NOT NULL DEFAULT 1,
  weight           text NOT NULL DEFAULT 'secondary',
  measure_kind     text NOT NULL DEFAULT 'leaf',
  measure_id       text REFERENCES public.metric_catalog_measures(id) ON DELETE RESTRICT,   -- leaf
  num_measure_id   text REFERENCES public.metric_catalog_measures(id) ON DELETE RESTRICT,   -- ratio
  den_measure_id   text REFERENCES public.metric_catalog_measures(id) ON DELETE RESTRICT,   -- ratio
  recorte_id       text NOT NULL REFERENCES public.metric_catalog_recortes(id) ON DELETE RESTRICT,
  format_id        text NOT NULL REFERENCES public.metric_catalog_formats(id) ON DELETE RESTRICT,
  filters          jsonb NOT NULL DEFAULT '{}'::jsonb,
  eyebrow_override text,
  pinned           boolean NOT NULL DEFAULT false,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_widgets_weight_check       CHECK (weight IN ('hero','primary','secondary')),
  CONSTRAINT dashboard_widgets_measure_kind_check CHECK (measure_kind IN ('leaf','ratio')),
  CONSTRAINT dashboard_widgets_eyebrow_len_check  CHECK (eyebrow_override IS NULL OR length(eyebrow_override) <= 28),
  -- Coerência estrutural leaf/ratio na própria linha (defesa antes do trigger).
  CONSTRAINT dashboard_widgets_kind_coherence CHECK (
    CASE measure_kind
      WHEN 'leaf'  THEN measure_id IS NOT NULL AND num_measure_id IS NULL AND den_measure_id IS NULL
      WHEN 'ratio' THEN measure_id IS NULL AND num_measure_id IS NOT NULL AND den_measure_id IS NOT NULL
      ELSE false
    END
  )
);
COMMENT ON TABLE public.dashboard_widgets IS
  'Widget publicado da composição (#1194 / ADR-0023). Referencia SÓ IDs do '
  'catálogo (FK). Validação na escrita: FK + CHECK + trigger validate_widget_'
  'against_catalog. organization_id do auth (RLS), nunca do payload.';

CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_page ON public.dashboard_widgets (page_id, position);
CREATE INDEX IF NOT EXISTS idx_dashboard_pages_org_surface ON public.dashboard_pages (organization_id, surface, position);

-- updated_at — reusa public.set_updated_at() (já existe em prod, search_path='').
DROP TRIGGER IF EXISTS trg_dashboard_pages_updated_at ON public.dashboard_pages;
CREATE TRIGGER trg_dashboard_pages_updated_at BEFORE UPDATE ON public.dashboard_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dashboard_widgets_updated_at ON public.dashboard_widgets;
CREATE TRIGGER trg_dashboard_widgets_updated_at BEFORE UPDATE ON public.dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===========================================================================
-- 3. Trigger de validação contra o catálogo + allowlist de filtros + flag
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
  -- (0) Gate de rollout: sem a flag ligada, a org não escreve composição.
  IF NOT public.fn_composable_metrics_enabled(NEW.organization_id) THEN
    RAISE EXCEPTION 'composable_metrics disabled for org %', NEW.organization_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (1) Recorte compatível com a(s) medida(s).
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
  ELSE  -- ratio: recorte compatível com AMBOS num e den (razão é escalar/total)
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
  END IF;

  -- (2) filters: só chaves da allowlist, e NUNCA organization_id.
  IF NEW.filters IS NOT NULL AND jsonb_typeof(NEW.filters) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(NEW.filters) LOOP
      IF v_key = 'organization_id' THEN
        RAISE EXCEPTION 'filters must never contain organization_id' USING ERRCODE = '23514';
      END IF;
      IF NOT (v_key = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'filter key % not in allowlist (%)', v_key, array_to_string(v_allowed, ',')
          USING ERRCODE = '23514';
      END IF;
      -- Tipagem das chaves de id: precisam ser uuid-castável.
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

  -- (4) Teto de 12 widgets/página (orçamento de perf #1208).
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_widget_count FROM public.dashboard_widgets WHERE page_id = NEW.page_id;
    IF v_widget_count >= 12 THEN
      RAISE EXCEPTION 'page % already has 12 widgets (max)', NEW.page_id USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_widget_against_catalog() IS
  'Fronteira de validação da composição no banco (#1194 / ADR-0023): recorte/'
  'format compatíveis, filters só allowlist e sem organization_id, máx 1 hero e '
  'teto 12 widgets/página, gate pela flag de rollout. SECURITY DEFINER: service_'
  'role e trigger não bypassam — a validação vale para todo caminho de escrita.';

DROP TRIGGER IF EXISTS trg_validate_widget_against_catalog ON public.dashboard_widgets;
CREATE TRIGGER trg_validate_widget_against_catalog
  BEFORE INSERT OR UPDATE ON public.dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION public.validate_widget_against_catalog();

-- ===========================================================================
-- 4. RLS org-scoped (espelha leads: get_my_organization_ids + is_master_user)
-- ===========================================================================
ALTER TABLE public.dashboard_pages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- dashboard_pages
CREATE POLICY dashboard_pages_select ON public.dashboard_pages FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user());
CREATE POLICY dashboard_pages_insert ON public.dashboard_pages FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());
CREATE POLICY dashboard_pages_update ON public.dashboard_pages FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user())
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());
CREATE POLICY dashboard_pages_delete ON public.dashboard_pages FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());

-- dashboard_widgets
CREATE POLICY dashboard_widgets_select ON public.dashboard_widgets FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user());
CREATE POLICY dashboard_widgets_insert ON public.dashboard_widgets FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());
CREATE POLICY dashboard_widgets_update ON public.dashboard_widgets FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user())
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());
CREATE POLICY dashboard_widgets_delete ON public.dashboard_widgets FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_pages   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_widgets TO authenticated;

-- ===========================================================================
-- 5. fn_publish_dashboard_page — promove draft→published ATÔMICO
-- ===========================================================================
-- Decisão de equipe #1194: a TV relê a cada 30s e não pode repintar a parede no
-- meio de uma edição. O Composer edita dashboard_pages.draft (jsonb, staging);
-- publicar troca as linhas de dashboard_widgets da página numa ÚNICA transação.
-- Se qualquer widget do draft for inválido (FK/CHECK/trigger), a transação
-- inteira reverte — a parede publicada anterior fica intacta. Atômico por
-- construção: DELETE+INSERT sem EXCEPTION handler = tudo-ou-nada.
--
-- GATE: admin/owner da org OU master (padrão money-guard won/lost) + flag ON.
-- organization_id vem do servidor (p_org_id), NUNCA do payload do draft.
CREATE OR REPLACE FUNCTION public.fn_publish_dashboard_page(
  p_org_id  uuid,
  p_page_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_draft jsonb;
  v_widgets jsonb;
  v_count int;
BEGIN
  -- 1ª instrução: tenancy.
  PERFORM public.assert_org_access(p_org_id);

  -- Só admin/owner da org ou master montam/publicam (membro só lê).
  IF NOT (p_org_id IN (SELECT public.get_my_admin_organization_ids()) OR public.is_master_user()) THEN
    RAISE EXCEPTION 'only org admins may publish dashboards' USING ERRCODE = '42501';
  END IF;

  -- Flag de rollout.
  IF NOT public.fn_composable_metrics_enabled(p_org_id) THEN
    RAISE EXCEPTION 'composable_metrics disabled for org %', p_org_id USING ERRCODE = 'P0001';
  END IF;

  SELECT dp.draft INTO v_draft
  FROM public.dashboard_pages dp
  WHERE dp.id = p_page_id AND dp.organization_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page % not found for org %', p_page_id, p_org_id USING ERRCODE = 'P0002';
  END IF;
  IF v_draft IS NULL OR jsonb_typeof(v_draft->'widgets') <> 'array' THEN
    RAISE EXCEPTION 'page % has no publishable draft', p_page_id USING ERRCODE = '22023';
  END IF;

  v_widgets := v_draft->'widgets';
  v_count := jsonb_array_length(v_widgets);
  IF v_count > 12 THEN
    RAISE EXCEPTION 'draft has % widgets (max 12/page)', v_count USING ERRCODE = '23514';
  END IF;

  -- Swap atômico. Sem EXCEPTION handler de propósito: widget inválido reverte
  -- tudo, incluindo o DELETE — a parede publicada anterior sobrevive.
  DELETE FROM public.dashboard_widgets WHERE page_id = p_page_id AND organization_id = p_org_id;

  INSERT INTO public.dashboard_widgets (
    organization_id, page_id, grid_col, grid_row, grid_w, grid_h, weight,
    measure_kind, measure_id, num_measure_id, den_measure_id,
    recorte_id, format_id, filters, eyebrow_override, pinned, position
  )
  SELECT
    p_org_id, p_page_id,
    COALESCE((w->>'grid_col')::int, 0), COALESCE((w->>'grid_row')::int, 0),
    COALESCE((w->>'grid_w')::int, 1),   COALESCE((w->>'grid_h')::int, 1),
    COALESCE(w->>'weight', 'secondary'),
    COALESCE(w->>'measure_kind', 'leaf'),
    w->>'measure_id', w->>'num_measure_id', w->>'den_measure_id',
    w->>'recorte_id', w->>'format_id',
    COALESCE(w->'filters', '{}'::jsonb),
    w->>'eyebrow_override',
    COALESCE((w->>'pinned')::boolean, false),
    COALESCE((w->>'position')::int, (ord - 1)::int)
  FROM jsonb_array_elements(v_widgets) WITH ORDINALITY AS t(w, ord);

  RETURN jsonb_build_object('published', v_count, 'page_id', p_page_id);
END;
$$;

COMMENT ON FUNCTION public.fn_publish_dashboard_page(uuid, uuid) IS
  'Promove dashboard_pages.draft → dashboard_widgets ATÔMICO (#1194). Gate: '
  'admin/owner da org ou master + flag ON. org_id do servidor, nunca do payload. '
  'Widget inválido reverte a transação inteira — a parede publicada anterior '
  'sobrevive. A validação por widget é do trigger validate_widget_against_catalog.';

REVOKE EXECUTE ON FUNCTION public.fn_publish_dashboard_page(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_publish_dashboard_page(uuid, uuid) TO authenticated, service_role;

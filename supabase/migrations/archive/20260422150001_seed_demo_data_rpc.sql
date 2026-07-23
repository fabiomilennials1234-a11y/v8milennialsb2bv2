-- ============================================================
-- Migration: seed_demo_data + remove_demo_data RPCs
-- Onda 3.2 — Sprint 3.2.4
--
-- RPCs SECURITY DEFINER com guard admin.
-- Watermark [DEMO] em todos os leads criados.
-- Completamente reversível via remove_demo_data.
-- ============================================================

-- ─── seed_demo_data ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_id    uuid  := auth.uid();
  v_is_admin     boolean;
  v_tag_id       uuid;
  v_pipeline_id  uuid;
  v_leads_created int  := 0;
  v_lead_id      uuid;
  i              int;
  v_already_seeded boolean;
BEGIN
  -- ── Guard: caller deve ser admin da org ────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_caller_id
      AND organization_id = p_org_id
      AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'insufficient_privilege: apenas admin pode popular dados demo'
      USING ERRCODE = '42501';
  END IF;

  -- ── Guard: idempotente — já foi semeado? ───────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.lead_tags lt ON lt.lead_id = l.id
    JOIN public.tags t ON t.id = lt.tag_id
    WHERE l.organization_id = p_org_id
      AND t.name = 'demo'
      AND t.organization_id = p_org_id
    LIMIT 1
  ) INTO v_already_seeded;

  IF v_already_seeded THEN
    RETURN jsonb_build_object(
      'already_seeded', true,
      'leads', 0
    );
  END IF;

  -- ── 1. Tag demo ─────────────────────────────────────────────────────────────
  INSERT INTO public.tags (organization_id, name, color)
  VALUES (p_org_id, 'demo', '#facc15')
  ON CONFLICT (name, organization_id) DO NOTHING
  RETURNING id INTO v_tag_id;

  IF v_tag_id IS NULL THEN
    SELECT id INTO v_tag_id
    FROM public.tags
    WHERE organization_id = p_org_id AND name = 'demo';
  END IF;

  -- ── 2. Pipeline demo ────────────────────────────────────────────────────────
  INSERT INTO public.custom_pipelines (
    organization_id,
    name,
    slug,
    description,
    color
  )
  VALUES (
    p_org_id,
    'Demo Pipeline',
    'demo-pipeline',
    'Pipeline criado automaticamente com dados de demonstração',
    '#facc15'
  )
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id INTO v_pipeline_id;

  IF v_pipeline_id IS NULL THEN
    SELECT id INTO v_pipeline_id
    FROM public.custom_pipelines
    WHERE organization_id = p_org_id AND slug = 'demo-pipeline';
  END IF;

  -- ── 3. 10 leads fake ────────────────────────────────────────────────────────
  FOR i IN 1..10 LOOP
    INSERT INTO public.leads (
      organization_id,
      name,
      company,
      phone,
      email,
      origin,
      rating
    ) VALUES (
      p_org_id,
      '[DEMO] Lead ' || i || ' — ' || (ARRAY[
        'João Silva', 'Maria Oliveira', 'Carlos Santos', 'Ana Costa',
        'Pedro Lima', 'Fernanda Rocha', 'Ricardo Mendes', 'Juliana Alves',
        'Marcos Pereira', 'Patrícia Souza'
      ])[i],
      (ARRAY[
        'Distribuidora Alpha', 'Metalúrgica Beta', 'Logística Gamma',
        'Comércio Delta', 'Fábrica Epsilon', 'Transportes Zeta',
        'Indústria Eta', 'Atacado Theta', 'Importadora Iota', 'Serviços Kappa'
      ])[i],
      '+55 11 99999-90' || LPAD(i::text, 2, '0'),
      'demo' || i || '@torquecrm-demo.com',
      'outro',
      CASE WHEN i <= 3 THEN 5 WHEN i <= 6 THEN 3 ELSE 1 END
    )
    RETURNING id INTO v_lead_id;

    -- Associar tag demo ao lead
    INSERT INTO public.lead_tags (lead_id, tag_id)
    VALUES (v_lead_id, v_tag_id)
    ON CONFLICT DO NOTHING;

    v_leads_created := v_leads_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'already_seeded', false,
    'leads',       v_leads_created,
    'tag_id',      v_tag_id,
    'pipeline_id', v_pipeline_id
  );
END;
$$;

-- ─── remove_demo_data ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.remove_demo_data(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_id    uuid  := auth.uid();
  v_is_admin     boolean;
  v_tag_id       uuid;
  v_leads_deleted int  := 0;
BEGIN
  -- ── Guard: caller deve ser admin da org ────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_caller_id
      AND organization_id = p_org_id
      AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'insufficient_privilege: apenas admin pode remover dados demo'
      USING ERRCODE = '42501';
  END IF;

  -- ── Buscar tag demo ─────────────────────────────────────────────────────────
  SELECT id INTO v_tag_id
  FROM public.tags
  WHERE organization_id = p_org_id AND name = 'demo';

  IF v_tag_id IS NULL THEN
    RETURN jsonb_build_object('removed', 0, 'reason', 'no_demo_tag');
  END IF;

  -- ── Deletar leads com watermark [DEMO] + tag demo ──────────────────────────
  -- Ordem respeita FK: lead_tags cascade via ON DELETE CASCADE em leads,
  -- mas deletar explicitamente para garantir.

  -- lead_tags primeiro (embora cascade, explícito é mais seguro em seeds)
  DELETE FROM public.lead_tags
  WHERE tag_id = v_tag_id
    AND lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id = p_org_id
        AND name LIKE '[DEMO]%'
    );

  -- Leads com watermark
  DELETE FROM public.leads
  WHERE organization_id = p_org_id
    AND name LIKE '[DEMO]%';

  GET DIAGNOSTICS v_leads_deleted = ROW_COUNT;

  -- ── Deletar pipeline demo ───────────────────────────────────────────────────
  DELETE FROM public.custom_pipelines
  WHERE organization_id = p_org_id
    AND slug = 'demo-pipeline';

  RETURN jsonb_build_object(
    'removed',      v_leads_deleted,
    'pipeline',     'demo-pipeline'
  );
END;
$$;

-- ─── Permissões ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.seed_demo_data FROM public;
REVOKE ALL ON FUNCTION public.remove_demo_data FROM public;
GRANT EXECUTE ON FUNCTION public.seed_demo_data TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_demo_data TO authenticated;

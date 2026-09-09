-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-616 — VERDE: asserções extras pós-migration (além do DO block
-- que a própria migration carrega) + sonda de escrita via INSTEAD OF.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Fidelidade coluna a coluna (exceto position, renumerada por D-d,
--     e updated_at, tocado pela carga) ───────────────────────────────────────
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM (
    SELECT id, organization_id, pipeline_id, stage_key, name, color, is_active,
           is_final_positive, is_final_negative, target_pipeline_id,
           target_stage_id, target_pipe_type, target_stage_key, created_at,
           checklist_template_id, stage_role, suggested_stage_role,
           stage_role_suggested_at, stage_role_suggestion_source,
           stage_role_reviewed_at, stage_role_reviewed_by, requires_sale_value
    FROM _e616_pre
    EXCEPT
    SELECT id, organization_id, pipeline_id, stage_key, name, color, is_active,
           is_final_positive, is_final_negative, target_pipeline_id,
           target_stage_id, target_pipe_type, target_stage_key, created_at,
           checklist_template_id, stage_role, suggested_stage_role,
           stage_role_suggested_at, stage_role_suggestion_source,
           stage_role_reviewed_at, stage_role_reviewed_by, requires_sale_value
    FROM public.custom_pipeline_stages
  ) d;
  IF v <> 0 THEN
    RAISE EXCEPTION 'VERDE FALHOU: % linhas custom divergem coluna a coluna após a migração', v;
  END IF;
  RAISE NOTICE 'verde: fidelidade coluna a coluna OK';
END $$;

-- ─── Ordem relativa preservada (custom, por funil e por is_active) ─────────
DO $$
DECLARE v bigint;
BEGIN
  WITH pre AS (
    SELECT pipeline_id, COALESCE(is_active, true) AS act,
           array_agg(id ORDER BY position, created_at, id) AS arr
    FROM _e616_pre GROUP BY 1, 2
  ), post AS (
    SELECT ps.pipeline_id, ps.is_active AS act,
           array_agg(ps.id ORDER BY ps.position) AS arr
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
    GROUP BY 1, 2
  )
  SELECT count(*) INTO v
  FROM pre FULL JOIN post USING (pipeline_id, act)
  WHERE pre.arr IS DISTINCT FROM post.arr;
  IF v <> 0 THEN
    RAISE EXCEPTION 'VERDE FALHOU: ordem relativa de % grupos (funil custom, is_active) mudou', v;
  END IF;
  RAISE NOTICE 'verde: ordem relativa custom OK';
END $$;

-- ─── Ordem relativa preservada (sistema, por org+tipo e por is_active) ─────
DO $$
DECLARE v bigint;
BEGIN
  WITH pre AS (
    SELECT organization_id, pipeline_type, is_active AS act,
           array_agg(id ORDER BY position, created_at, id) AS arr
    FROM _e616_sys_pre
    WHERE pipeline_type IN ('whatsapp','confirmacao','propostas')
    GROUP BY 1, 2, 3
  ), post AS (
    SELECT organization_id, pipeline_type, is_active AS act,
           array_agg(id ORDER BY position, created_at, id) AS arr
    FROM public.pipeline_stages
    WHERE pipeline_type IN ('whatsapp','confirmacao','propostas')
    GROUP BY 1, 2, 3
  )
  SELECT count(*) INTO v
  FROM pre FULL JOIN post USING (organization_id, pipeline_type, act)
  WHERE pre.arr IS DISTINCT FROM post.arr;
  IF v <> 0 THEN
    RAISE EXCEPTION 'VERDE FALHOU: ordem relativa de % grupos de sistema mudou', v;
  END IF;
  RAISE NOTICE 'verde: ordem relativa sistema OK';
END $$;

-- ─── Sonda INSTEAD OF: insert → update → delete via view ───────────────────
DO $$
DECLARE
  v_pipe uuid;
  v_org  uuid;
  v_id   uuid;
  v_type text;
BEGIN
  SELECT p.id, p.organization_id INTO v_pipe, v_org
  FROM public.pipelines p WHERE p.type = 'custom' LIMIT 1;
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: nenhum funil custom para a sonda';
  END IF;

  INSERT INTO public.custom_pipeline_stages (organization_id, pipeline_id, stage_key, name, position)
  VALUES (v_org, v_pipe, '_e616_probe', 'Sonda SCRUM-616', 5000)
  RETURNING id INTO v_id;

  SELECT pipeline_type INTO v_type FROM public.pipeline_stages WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERDE FALHOU: sonda não aterrissou em pipeline_stages';
  END IF;
  IF v_type IS NOT NULL THEN
    RAISE EXCEPTION 'VERDE FALHOU: sonda nasceu com pipeline_type=% (esperado NULL)', v_type;
  END IF;

  UPDATE public.custom_pipeline_stages SET name = 'Sonda editada' WHERE id = v_id;
  IF (SELECT name FROM public.pipeline_stages WHERE id = v_id) <> 'Sonda editada' THEN
    RAISE EXCEPTION 'VERDE FALHOU: INSTEAD OF UPDATE não propagou';
  END IF;

  DELETE FROM public.custom_pipeline_stages WHERE id = v_id;
  IF EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_id) THEN
    RAISE EXCEPTION 'VERDE FALHOU: INSTEAD OF DELETE não propagou';
  END IF;

  RAISE NOTICE 'verde: sonda INSTEAD OF (I/U/D) OK';
END $$;

-- ─── Sonda da RPC de reorder (statement único atravessa a UNIQUE) ──────────
DO $$
DECLARE
  v_pipe uuid;
  v_ids  uuid[];
  v_n    integer;
BEGIN
  SELECT ps.pipeline_id INTO v_pipe
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
  WHERE ps.is_active
  GROUP BY ps.pipeline_id HAVING count(*) >= 2 LIMIT 1;
  IF v_pipe IS NULL THEN
    RAISE NOTICE 'verde: sem funil custom com 2+ etapas ativas — sonda de reorder pulada';
    RETURN;
  END IF;

  -- Inverte a ordem atual: toda permutação transita por posições ocupadas.
  SELECT array_agg(id ORDER BY position DESC) INTO v_ids
  FROM public.pipeline_stages WHERE pipeline_id = v_pipe AND is_active;

  v_n := public.reorder_pipeline_stages(v_ids);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'VERDE FALHOU: reorder_pipeline_stages atualizou só % linhas', v_n;
  END IF;

  -- Volta ao que era (o ROLLBACK final desfaz de qualquer forma; isto mantém as
  -- asserções seguintes coerentes).
  SELECT array_agg(id ORDER BY position DESC) INTO v_ids
  FROM public.pipeline_stages WHERE pipeline_id = v_pipe AND is_active;
  PERFORM public.reorder_pipeline_stages(v_ids);

  RAISE NOTICE 'verde: sonda reorder_pipeline_stages OK (% linhas)', v_n;
END $$;

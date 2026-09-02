-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-621 — DEPOIS: sondas contra o estado pós-migration.
--   1. I/U/D com RETURNING nas duas views (INSTEAD OF completo).
--   2. Workflow custom: contexto chega IGUAL ao evaluator (ADR-0031) —
--      pipeline_id sem pipe_type, from/to por stage_key, sujeito = entry id.
--   3. Dispatch NÃO enfileira pra custom (D11 é W3, não aqui).
--   4. Tenancy: responsável de outra org é recusado (access_denied).
-- Termina em RAISE EXCEPTION 'ENSAIO_OK ...' (aborta) + ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════

-- Sem semeadura automática de funil no lead-sonda: mantém o delta de dispatch
-- limpo (mesmo escape usado por import_lead_into_custom_pipeline).
SELECT set_config('app.skip_default_pipe', '1', true);

-- ─── Escolhe a sonda: org com funil custom ativo, 2+ etapas, member ativo ───
CREATE TEMP TABLE _e621_probe ON COMMIT DROP AS
SELECT
  cp.organization_id AS org,
  cp.id              AS pipe,
  s1.id  AS stage1, s1.stage_key AS stage1_key,
  s2.id  AS stage2, s2.stage_key AS stage2_key,
  (SELECT tm.id FROM public.team_members tm
    WHERE tm.organization_id = cp.organization_id AND tm.is_active LIMIT 1) AS member,
  (SELECT tm2.id FROM public.team_members tm2
    WHERE tm2.organization_id <> cp.organization_id AND tm2.is_active LIMIT 1) AS member_de_outra_org
FROM public.custom_pipelines cp
CROSS JOIN LATERAL (
  SELECT id, stage_key FROM public.custom_pipeline_stages
  WHERE pipeline_id = cp.id AND is_active ORDER BY position LIMIT 1) s1
CROSS JOIN LATERAL (
  SELECT id, stage_key FROM public.custom_pipeline_stages
  WHERE pipeline_id = cp.id AND is_active ORDER BY position OFFSET 1 LIMIT 1) s2
WHERE cp.is_active
  AND EXISTS (SELECT 1 FROM public.team_members tm
               WHERE tm.organization_id = cp.organization_id AND tm.is_active)
LIMIT 1;

DO $$
DECLARE
  p record;
  v_lead uuid;
  v_card uuid;
  v_wf_created uuid;
  v_wf_moved   uuid;
  v_pipe_probe uuid;
  v_row record;
  v_pe record;
  v_exec record;
  v_n bigint;
  v_spm_delta bigint;
  v_wfx_probe bigint;
  v_reinseridas bigint;
  v_fonte bigint;
  v_denied boolean := false;
BEGIN
  SELECT * INTO p FROM _e621_probe;
  IF p.pipe IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 621: sonda vazia (controle deveria ter pego)';
  END IF;

  -- ── Sondas de workflow: capturam o shape do contexto custom (ADR-0031) ────
  INSERT INTO public.workflows (organization_id, name, trigger_type, trigger_config, is_active)
  VALUES (p.org, '[ENSAIO-621] lead_created', 'lead_created', '{}'::jsonb, true)
  RETURNING id INTO v_wf_created;

  INSERT INTO public.workflows (organization_id, name, trigger_type, trigger_config, is_active)
  VALUES (p.org, '[ENSAIO-621] stage_changed', 'stage_changed',
          jsonb_build_object('pipeline_id', p.pipe::text), true)
  RETURNING id INTO v_wf_moved;

  INSERT INTO public.leads (organization_id, name, origin)
  VALUES (p.org, '[ENSAIO-621] sonda', 'outro')
  RETURNING id INTO v_lead;

  -- ── 1a. INSERT na view custom_pipe_entries (RETURNING + defaults) ─────────
  INSERT INTO public.custom_pipe_entries
    (organization_id, pipeline_id, lead_id, stage_id,
     pre_sale_responsible_id, sale_responsible_id)
  VALUES (p.org, p.pipe, v_lead, p.stage1, p.member, p.member)
  RETURNING id INTO v_card;

  IF v_card IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 621: INSERT na view não devolveu RETURNING';
  END IF;

  SELECT * INTO v_pe FROM public.pipeline_entries WHERE id = v_card;
  IF v_pe.id IS NULL OR v_pe.stage_key IS DISTINCT FROM p.stage1_key
     OR v_pe.stage_id IS DISTINCT FROM p.stage1 THEN
    RAISE EXCEPTION 'ENSAIO 621: fonte não recebeu o card (stage_key=%, esperado %)',
      v_pe.stage_key, p.stage1_key;
  END IF;
  IF (v_pe.metadata->>'pre_sale_responsible_id')::uuid IS DISTINCT FROM p.member THEN
    RAISE EXCEPTION 'ENSAIO 621: pre_sale_responsible_id não chegou em metadata';
  END IF;
  SELECT * INTO v_row FROM public.custom_pipe_entries WHERE id = v_card;
  IF v_row.pre_sale_responsible_id IS DISTINCT FROM p.member
     OR v_row.sale_responsible_id IS DISTINCT FROM p.member THEN
    RAISE EXCEPTION 'ENSAIO 621: roundtrip dos responsáveis falhou na view';
  END IF;

  -- Workflow no INSERT: lead_created chegou com pipeline_id e SEM pipe_type.
  -- (O INSERT do lead-sonda também dispara o lead_created da tabela leads —
  --  ruído esperado; a asserção procura a execução DO CAMINHO CUSTOM.)
  SELECT * INTO v_exec FROM public.workflow_executions
   WHERE workflow_id = v_wf_created AND lead_id = v_lead
     AND context->>'pipeline_id' = p.pipe::text
   ORDER BY updated_at DESC LIMIT 1;
  IF v_exec.id IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 621: lead_created custom não disparou workflow (contexto pipeline_id ausente)';
  END IF;
  IF v_exec.context ? 'pipe_type' THEN
    RAISE EXCEPTION 'ENSAIO 621: contexto lead_created divergiu do ADR-0031: %', v_exec.context;
  END IF;

  -- ── 1b. UPDATE de etapa via view → espelho + workflow com sujeito ─────────
  UPDATE public.custom_pipe_entries
     SET stage_id = p.stage2, stage_changed_at = now()
   WHERE id = v_card;

  SELECT * INTO v_pe FROM public.pipeline_entries WHERE id = v_card;
  IF v_pe.stage_id IS DISTINCT FROM p.stage2 OR v_pe.stage_key IS DISTINCT FROM p.stage2_key THEN
    RAISE EXCEPTION 'ENSAIO 621: UPDATE de stage não espelhou (stage_key=%, esperado %)',
      v_pe.stage_key, p.stage2_key;
  END IF;

  SELECT * INTO v_exec FROM public.workflow_executions
   WHERE workflow_id = v_wf_moved AND lead_id = v_lead
     AND context->>'from_stage' = p.stage1_key
   ORDER BY updated_at DESC LIMIT 1;
  IF v_exec.id IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 621: stage_changed custom não disparou no movimento';
  END IF;
  IF v_exec.context->>'to_stage' IS DISTINCT FROM p.stage2_key
     OR v_exec.context->>'pipeline_id' IS DISTINCT FROM p.pipe::text
     OR (v_exec.context->>'pipeline_entry_id')::uuid IS DISTINCT FROM v_card
     OR v_exec.context ? 'pipe_type' THEN
    RAISE EXCEPTION 'ENSAIO 621: contexto stage_changed divergiu do ADR-0031: %', v_exec.context;
  END IF;

  -- ── 2. Tenancy: responsável de outra org é recusado ───────────────────────
  IF p.member_de_outra_org IS NOT NULL THEN
    BEGIN
      UPDATE public.custom_pipe_entries
         SET pre_sale_responsible_id = p.member_de_outra_org
       WHERE id = v_card;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'access_denied%' THEN v_denied := true; END IF;
    END;
    IF NOT v_denied THEN
      RAISE EXCEPTION 'ENSAIO 621: responsável cross-org NÃO foi recusado';
    END IF;
  END IF;

  -- ── 3. View custom_pipelines: I/U/D + roundtrip do config ─────────────────
  INSERT INTO public.custom_pipelines
    (organization_id, name, slug, lifecycle_type, status, template_type, starts_at, team_goal)
  VALUES (p.org, '[ENSAIO-621] funil', 'ensaio-scrum621-probe',
          'temporary', 'draft', 'indicacao', now(), 42)
  RETURNING id INTO v_pipe_probe;

  SELECT * INTO v_row FROM public.custom_pipelines WHERE id = v_pipe_probe;
  IF v_row.lifecycle_type <> 'temporary' OR v_row.status <> 'draft'
     OR v_row.template_type <> 'indicacao' OR v_row.team_goal <> 42
     OR v_row.starts_at IS NULL OR v_row.position <> 0 THEN
    RAISE EXCEPTION 'ENSAIO 621: roundtrip do funil probe falhou (lc=% st=% tt=% tg=% pos=%)',
      v_row.lifecycle_type, v_row.status, v_row.template_type, v_row.team_goal, v_row.position;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = v_pipe_probe AND type = 'custom' AND display_order = 3
                    AND config->>'lifecycle_type' = 'temporary') THEN
    RAISE EXCEPTION 'ENSAIO 621: fonte pipelines não recebeu o funil probe como esperado';
  END IF;

  UPDATE public.custom_pipelines SET status = 'active', name = '[ENSAIO-621] v2'
   WHERE id = v_pipe_probe;
  IF (SELECT status FROM public.custom_pipelines WHERE id = v_pipe_probe) <> 'active' THEN
    RAISE EXCEPTION 'ENSAIO 621: UPDATE do funil probe não refletiu';
  END IF;

  DELETE FROM public.custom_pipelines WHERE id = v_pipe_probe;
  IF EXISTS (SELECT 1 FROM public.pipelines WHERE id = v_pipe_probe) THEN
    RAISE EXCEPTION 'ENSAIO 621: DELETE do funil probe não apagou a fonte';
  END IF;

  -- ── 4. DELETE do card via view ────────────────────────────────────────────
  DELETE FROM public.custom_pipe_entries WHERE id = v_card;
  IF EXISTS (SELECT 1 FROM public.pipeline_entries WHERE id = v_card) THEN
    RAISE EXCEPTION 'ENSAIO 621: DELETE do card via view não apagou a fonte';
  END IF;

  -- ── 5. Dispatch continua cego pra custom (D11 = W3) ───────────────────────
  SELECT count(*) - (SELECT spm_total FROM _e621_pre) INTO v_spm_delta
  FROM public.scheduled_pipe_messages;
  IF v_spm_delta <> 0 THEN
    RAISE EXCEPTION 'ENSAIO 621: dispatch enfileirou % mensagens em movimento custom (D11 vazou)', v_spm_delta;
  END IF;

  -- ── Números finais ────────────────────────────────────────────────────────
  SELECT count(*) INTO v_reinseridas FROM _scrum621_reinseridas;
  SELECT count(*) INTO v_fonte FROM public.custom_pipe_entries;
  SELECT count(*) INTO v_wfx_probe FROM public.workflow_executions
   WHERE workflow_id IN (v_wf_created, v_wf_moved);

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-621 fonte=% reinseridas=% funis=% wfx_sondas=% dispatch_delta=0 tenancy_negada=%',
    v_fonte, v_reinseridas, (SELECT count(*) FROM public.custom_pipelines), v_wfx_probe, v_denied;
END $$;

ROLLBACK;

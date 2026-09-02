-- ENSAIO ABORTÁVEL — SCRUM-627 (contexto único dos gatilhos de workflow)
-- Roda contra PROD via scripts/prod-sql.mjs --file. TUDO dentro de uma
-- transação com ROLLBACK no fim — nada persiste (o pg_net enfileira em tabela,
-- que também é revertida; nenhum HTTP sai antes do COMMIT que não acontece).
--
-- Prova:
--   1. a migration 20270908006000 aplica limpa em cima do schema de prod;
--   2. move em card CUSTOM disparado por UPDATE SÓ de stage_id (a limitação
--      D-g) cria execução com o CONTEXTO NOVO (entry/stage_id/stage_key/
--      pipeline_id/deal_id) casando uma config NOVA (pipeline_id);
--   3. move em card SYSTEM por UPDATE só de stage_id enfileira o http_post
--      com o contexto novo (pipe_type eco incluso);
--   4. config LEGADA real de prod (amostra viva) casa com o contexto novo no
--      matcher SQL; e NÃO casa com contexto de funil custom (fail-closed).

BEGIN;

SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

-- ── 0. Migration inteira (colada pelo runner via \i não existe — o runner
--       concatena; ver ensaio-scrum627.sh) ─────────────────────────────────

-- (o shell injeta o conteúdo da migration aqui)

-- ── 1. Cenário ──────────────────────────────────────────────────────────────

CREATE TEMP TABLE ensaio_ids (k text PRIMARY KEY, v text) ON COMMIT DROP;

DO $ensaio$
DECLARE
  r_custom RECORD;
  r_system RECORD;
  v_wf uuid;
  v_exec RECORD;
  v_body jsonb;
  v_legada jsonb;
  v_ctx_novo jsonb;
  v_n int;
BEGIN
  -- Card CUSTOM vivo com lead e um funil com >=2 etapas não-terminais ativas
  SELECT pe.id AS entry_id, pe.lead_id, pe.organization_id, pe.pipeline_id,
         pe.stage_id, pe.stage_key, pe.deal_id,
         alvo.id AS alvo_stage_id, alvo.stage_key AS alvo_stage_key
    INTO r_custom
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
  JOIN LATERAL (
    SELECT ps.id, ps.stage_key
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = pe.pipeline_id
      AND ps.id IS DISTINCT FROM pe.stage_id
      AND ps.is_active
      AND COALESCE(ps.stage_role, 'open') NOT IN ('won', 'lost')
      AND ps.requires_sale_value IS NOT TRUE
    ORDER BY ps.position
    LIMIT 1
  ) alvo ON true
  WHERE pe.lead_id IS NOT NULL AND pe.stage_id IS NOT NULL AND pe.closed_at IS NULL
  LIMIT 1;

  IF r_custom IS NULL THEN RAISE EXCEPTION 'ENSAIO: nenhum card custom elegível'; END IF;

  -- Card SYSTEM vivo idem
  SELECT pe.id AS entry_id, pe.lead_id, pe.organization_id, pe.pipeline_id,
         pe.stage_id, pe.stage_key, pe.deal_id, p.slug,
         alvo.id AS alvo_stage_id, alvo.stage_key AS alvo_stage_key
    INTO r_system
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'system' AND p.slug = 'whatsapp'
  JOIN LATERAL (
    SELECT ps.id, ps.stage_key
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = pe.pipeline_id
      AND ps.id IS DISTINCT FROM pe.stage_id
      AND ps.is_active
      AND COALESCE(ps.stage_role, 'open') NOT IN ('won', 'lost')
      AND ps.requires_sale_value IS NOT TRUE
    ORDER BY ps.position
    LIMIT 1
  ) alvo ON true
  WHERE pe.lead_id IS NOT NULL AND pe.stage_id IS NOT NULL AND pe.closed_at IS NULL
  LIMIT 1;

  IF r_system IS NULL THEN RAISE EXCEPTION 'ENSAIO: nenhum card system elegível'; END IF;

  -- Workflow SINTÉTICO com config NOVA (pipeline_id + stage do alvo)
  INSERT INTO public.workflows (organization_id, name, trigger_type, trigger_config, definition, is_active)
  VALUES (
    r_custom.organization_id,
    '[ENSAIO-627] custom pipeline_id',
    'stage_changed',
    jsonb_build_object('pipeline_id', r_custom.pipeline_id::text,
                       'stages', jsonb_build_array(r_custom.alvo_stage_key)),
    '{"nodes":[],"edges":[]}'::jsonb,
    true
  ) RETURNING id INTO v_wf;

  -- ── 2. MOVE custom: UPDATE SÓ de stage_id (D-g: a lista OF tem que pegar) ──
  UPDATE public.pipeline_entries SET stage_id = r_custom.alvo_stage_id
  WHERE id = r_custom.entry_id;

  SELECT * INTO v_exec
  FROM public.workflow_executions we
  WHERE we.workflow_id = v_wf AND we.lead_id = r_custom.lead_id
  ORDER BY we.updated_at DESC LIMIT 1;

  IF v_exec IS NULL THEN
    RAISE EXCEPTION 'ENSAIO FALHOU: move custom (UPDATE só de stage_id) não criou execução';
  END IF;

  IF v_exec.context->>'pipeline_entry_id' IS DISTINCT FROM r_custom.entry_id::text
     OR v_exec.context->>'pipeline_id' IS DISTINCT FROM r_custom.pipeline_id::text
     OR v_exec.context->>'stage_id' IS DISTINCT FROM r_custom.alvo_stage_id::text
     OR v_exec.context->>'stage_key' IS DISTINCT FROM r_custom.alvo_stage_key
     OR v_exec.context->>'to_stage' IS DISTINCT FROM r_custom.alvo_stage_key
     OR v_exec.context->>'from_stage' IS DISTINCT FROM r_custom.stage_key
  THEN
    RAISE EXCEPTION 'ENSAIO FALHOU: contexto custom incompleto: %', v_exec.context;
  END IF;
  RAISE NOTICE 'OK custom: execução % contexto novo completo (entry=%, stage_id=%)',
    v_exec.id, v_exec.context->>'pipeline_entry_id', v_exec.context->>'stage_id';

  -- ── 3. MOVE system: UPDATE só de stage_id → http_post enfileirado ──────────
  SELECT count(*) INTO v_n FROM net.http_request_queue;

  UPDATE public.pipeline_entries SET stage_id = r_system.alvo_stage_id
  WHERE id = r_system.entry_id;

  SELECT convert_from(q.body, 'UTF8')::jsonb INTO v_body
  FROM net.http_request_queue q
  WHERE q.url LIKE '%process-workflow-executions%'
    AND convert_from(q.body, 'UTF8') LIKE '%' || r_system.entry_id::text || '%'
  ORDER BY q.id DESC LIMIT 1;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'ENSAIO FALHOU: move system (UPDATE só de stage_id) não enfileirou http_post (fila tinha % antes)', v_n;
  END IF;

  IF v_body->'context'->>'pipeline_entry_id' IS DISTINCT FROM r_system.entry_id::text
     OR v_body->'context'->>'stage_id' IS DISTINCT FROM r_system.alvo_stage_id::text
     OR v_body->'context'->>'stage_key' IS DISTINCT FROM r_system.alvo_stage_key
     OR v_body->'context'->>'pipe_type' IS DISTINCT FROM r_system.slug
     OR v_body->'context'->>'pipeline_id' IS DISTINCT FROM r_system.pipeline_id::text
  THEN
    RAISE EXCEPTION 'ENSAIO FALHOU: contexto system incompleto: %', v_body->'context';
  END IF;
  RAISE NOTICE 'OK system: http_post enfileirado com contexto novo (pipe_type=%, stage_id=%)',
    v_body->'context'->>'pipe_type', v_body->'context'->>'stage_id';

  -- ── 4. Config LEGADA REAL de prod casa com o contexto novo ────────────────
  SELECT w.trigger_config INTO v_legada
  FROM public.workflows w
  WHERE w.trigger_type = 'stage_changed' AND w.is_active
    AND COALESCE(w.trigger_config->>'pipe_type','') = 'whatsapp'
    AND COALESCE(w.trigger_config->>'pipeline_id','') = ''
  LIMIT 1;

  IF v_legada IS NULL THEN RAISE EXCEPTION 'ENSAIO: nenhuma config legada viva'; END IF;

  -- contexto novo de um move whatsapp para uma etapa que a config escuta
  v_ctx_novo := jsonb_build_object(
    'trigger', 'stage_changed',
    'pipeline_id', r_system.pipeline_id::text,
    'pipe_type', 'whatsapp',
    'pipeline_entry_id', r_system.entry_id::text,
    'stage_id', r_system.alvo_stage_id::text,
    'stage_key', (v_legada->'stages'->>0),
    'to_stage', (v_legada->'stages'->>0),
    'from_stage', 'x');

  IF NOT public.matches_workflow_trigger_config('stage_changed', v_legada, v_ctx_novo) THEN
    RAISE EXCEPTION 'ENSAIO FALHOU: config legada real % não casou com contexto novo %', v_legada, v_ctx_novo;
  END IF;

  -- fail-closed: a mesma config legada NÃO casa com contexto de funil custom
  IF public.matches_workflow_trigger_config('stage_changed', v_legada,
       jsonb_build_object('trigger','stage_changed',
                          'pipeline_id', r_custom.pipeline_id::text,
                          'pipeline_entry_id', r_custom.entry_id::text,
                          'to_stage', (v_legada->'stages'->>0)))
  THEN
    RAISE EXCEPTION 'ENSAIO FALHOU: config legada de sistema casou com contexto custom (fail-open)';
  END IF;

  RAISE NOTICE 'OK matcher: config legada real casa contexto novo; fail-closed contra custom';
  RAISE NOTICE 'ENSAIO_OK — SCRUM-627: migration aplica, OF duplo dispara, contexto único completo, config legada coberta';
END
$ensaio$;

ROLLBACK;
SELECT 'rolled back' AS fim;

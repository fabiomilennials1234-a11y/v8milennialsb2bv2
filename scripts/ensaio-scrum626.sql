-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-626 — ANTES: abre a transação, escolhe os alvos e captura o
-- BASELINE das 12 RPCs de prod (resultados + ACL) antes da fusão.
--
-- Payload montado por scripts/ensaio-scrum626.sh:
--   ensaio-scrum626.sql (BEGIN + _param + baselines)
--     → supabase/migrations/20270908003000_rpcs_fundidas_por_pipeline_id.sql
--     → scripts/ensaio-scrum626-depois.sql (paridade wrapper↔baseline +
--       sondas dos caminhos novos + deletes rolados + RAISE 'ENSAIO_OK' que
--       ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
--
-- Identidade: o ensaio roda como postgres (Management API), mas as RPCs
-- autorizam por auth.uid() → request.jwt.claims é apontado para um admin REAL
-- da org alvo (Milennials; e o admin da org pequena na sonda de delete system).
-- RLS: postgres bypassa — igual antes e depois, então as comparações valem.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── _param: alvos do ensaio ────────────────────────────────────────────────
CREATE TEMP TABLE _param (k text PRIMARY KEY, v text) ON COMMIT DROP;

INSERT INTO _param VALUES ('org_mil', '6030520a-2ca7-477d-be89-55758e2cd808');

-- Admin real da Milennials (as RPCs autorizam por membership via auth.uid()).
INSERT INTO _param
SELECT 'uid_mil', tm.user_id::text
FROM public.team_members tm
WHERE tm.organization_id = '6030520a-2ca7-477d-be89-55758e2cd808'
  AND tm.is_active AND tm.role = 'admin' AND tm.user_id IS NOT NULL
LIMIT 1;

-- Funil system alvo (whatsapp da Milennials) + etapa mais povoada + uma etapa
-- alvo diferente (não won/lost) para as sondas de bulk.
INSERT INTO _param
SELECT 'pipe_sys', p.id::text FROM public.pipelines p
WHERE p.organization_id = (SELECT v::uuid FROM _param WHERE k='org_mil')
  AND p.slug = 'whatsapp';

INSERT INTO _param
SELECT 'stage_top', pe.stage_key
FROM public.pipeline_entries pe
WHERE pe.pipeline_id = (SELECT v::uuid FROM _param WHERE k='pipe_sys')
  AND pe.lead_id IS NOT NULL
GROUP BY pe.stage_key ORDER BY count(*) DESC LIMIT 1;

INSERT INTO _param
SELECT 'stage_alvo_id', ps.id::text
FROM public.pipeline_stages ps
WHERE ps.pipeline_id = (SELECT v::uuid FROM _param WHERE k='pipe_sys')
  AND ps.stage_key <> (SELECT v FROM _param WHERE k='stage_top')
  AND COALESCE(ps.stage_role,'open') NOT IN ('won','lost')
ORDER BY ps.position LIMIT 1;

-- Funil custom C (leituras): o mais povoado da Milennials.
INSERT INTO _param
SELECT 'pipe_cus', p.id::text
FROM public.pipelines p
WHERE p.organization_id = (SELECT v::uuid FROM _param WHERE k='org_mil')
  AND p.type = 'custom' AND p.is_active
ORDER BY (SELECT count(*) FROM public.pipeline_entries pe WHERE pe.pipeline_id = p.id) DESC
LIMIT 1;

-- Primeira etapa de C (sonda de bulk custom pelo wrapper).
INSERT INTO _param
SELECT 'stage_cus_id', ps.id::text
FROM public.pipeline_stages ps
WHERE ps.pipeline_id = (SELECT v::uuid FROM _param WHERE k='pipe_cus')
  AND COALESCE(ps.stage_role,'open') NOT IN ('won','lost')
ORDER BY ps.position LIMIT 1;

-- Funil custom B (sonda de DELETE, rolada): o MENOR da Milennials, sem cards
-- invasores, distinto de C.
INSERT INTO _param
SELECT 'pipe_del', p.id::text
FROM public.pipelines p
WHERE p.organization_id = (SELECT v::uuid FROM _param WHERE k='org_mil')
  AND p.type = 'custom'
  AND p.id <> (SELECT v::uuid FROM _param WHERE k='pipe_cus')
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_entries e
    JOIN public.pipeline_stages s ON s.id = e.stage_id
    WHERE s.pipeline_id = p.id AND e.pipeline_id <> p.id)
ORDER BY (SELECT count(*) FROM public.pipeline_entries pe WHERE pe.pipeline_id = p.id) ASC
LIMIT 1;

-- Lead da sonda de bulk (card aberto na etapa mais povoada do whatsapp).
INSERT INTO _param
SELECT 'lead_bulk', pe.lead_id::text
FROM public.pipeline_entries pe
JOIN public.leads l ON l.id = pe.lead_id AND l.deleted_at IS NULL
WHERE pe.pipeline_id = (SELECT v::uuid FROM _param WHERE k='pipe_sys')
  AND pe.stage_key = (SELECT v FROM _param WHERE k='stage_top')
  AND pe.closed_at IS NULL
  AND pe.stage_id IS NOT NULL  -- fantasma não serve: a sonda H2 volta por stage_id
  AND NOT EXISTS (SELECT 1 FROM public.pipeline_stages cs
                   WHERE cs.id = pe.stage_id AND cs.stage_role IN ('won','lost'))
LIMIT 1;

-- Org pequena para a sonda de delete SYSTEM (rolada): menor nº de entries no
-- whatsapp, com registro (display_config), linha em pipelines e admin real.
INSERT INTO _param
SELECT 'org_peq', o.id::text
FROM public.organizations o
JOIN public.pipelines p ON p.organization_id = o.id AND p.slug = 'whatsapp'
JOIN public.pipeline_display_config dc ON dc.organization_id = o.id AND dc.pipe_type = 'whatsapp'
WHERE EXISTS (SELECT 1 FROM public.team_members tm
               WHERE tm.organization_id = o.id AND tm.is_active
                 AND tm.role = 'admin' AND tm.user_id IS NOT NULL)
ORDER BY (SELECT count(*) FROM public.pipeline_entries pe WHERE pe.pipeline_id = p.id) ASC
LIMIT 1;

INSERT INTO _param
SELECT 'uid_peq', tm.user_id::text
FROM public.team_members tm
WHERE tm.organization_id = (SELECT v::uuid FROM _param WHERE k='org_peq')
  AND tm.is_active AND tm.role = 'admin' AND tm.user_id IS NOT NULL
LIMIT 1;

DO $$
DECLARE r record; v_faltando text := '';
BEGIN
  FOR r IN SELECT unnest(ARRAY['org_mil','uid_mil','pipe_sys','stage_top','stage_alvo_id',
                               'pipe_cus','stage_cus_id','pipe_del','lead_bulk','org_peq','uid_peq']) AS k
  LOOP
    IF NOT EXISTS (SELECT 1 FROM _param WHERE k = r.k AND v IS NOT NULL) THEN
      v_faltando := v_faltando || ' ' || r.k;
    END IF;
  END LOOP;
  IF v_faltando <> '' THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: _param sem alvo(s):% — sem massa o ensaio não prova nada.', v_faltando;
  END IF;
  RAISE NOTICE '_param OK: sys=%, cus=%, del=%, org_peq=%',
    (SELECT v FROM _param WHERE k='pipe_sys'), (SELECT v FROM _param WHERE k='pipe_cus'),
    (SELECT v FROM _param WHERE k='pipe_del'), (SELECT v FROM _param WHERE k='org_peq');
END $$;

-- Identidade Milennials para todo o baseline.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _param WHERE k='uid_mil'), 'role', 'authenticated')::text,
  true);

-- ─── BASELINE 1: contagens ──────────────────────────────────────────────────
CREATE TEMP TABLE _e626_counts_sys ON COMMIT DROP AS
SELECT * FROM public.get_pipeline_stage_counts(
  'whatsapp', (SELECT v::uuid FROM _param WHERE k='org_mil'));

CREATE TEMP TABLE _e626_counts_cus ON COMMIT DROP AS
SELECT * FROM public.get_custom_pipeline_stage_counts(
  (SELECT v::uuid FROM _param WHERE k='pipe_cus'),
  (SELECT v::uuid FROM _param WHERE k='org_mil'));

-- ─── BASELINE 2: página do kanban (shape completo, 50 linhas) ───────────────
CREATE TEMP TABLE _e626_page_sys ON COMMIT DROP AS
SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id) AS pg
FROM public.get_pipeline_page(
  p_pipeline_slug => 'whatsapp',
  p_stage_id      => (SELECT v FROM _param WHERE k='stage_top'),
  p_org_id        => (SELECT v::uuid FROM _param WHERE k='org_mil'),
  p_page_size     => 50) t;

-- ─── BASELINE 3: públicos de disparo ────────────────────────────────────────
CREATE TEMP TABLE _e626_ids ON COMMIT DROP AS
SELECT
  (SELECT array_agg(x ORDER BY x) FROM public.get_stage_lead_ids(
     'whatsapp', (SELECT v FROM _param WHERE k='stage_top'),
     (SELECT v::uuid FROM _param WHERE k='org_mil')) x)                    AS ids_stage,
  (SELECT array_agg(x ORDER BY x) FROM public.get_filtered_lead_ids(
     p_pipeline_type => 'whatsapp', p_search => 'a',
     p_organization_id => (SELECT v::uuid FROM _param WHERE k='org_mil')) x) AS ids_filtered,
  (SELECT array_agg(x ORDER BY x) FROM public.get_custom_filtered_lead_ids(
     p_pipeline_id => (SELECT v::uuid FROM _param WHERE k='pipe_cus'),
     p_organization_id => (SELECT v::uuid FROM _param WHERE k='org_mil')) x) AS ids_custom;

-- ─── BASELINE 4: impact dos dois mundos (STABLE — não destrói nada) ─────────
CREATE TEMP TABLE _e626_impacts ON COMMIT DROP AS
SELECT
  public.custom_pipeline_delete_impact((SELECT v::uuid FROM _param WHERE k='pipe_del')) AS imp_cus,
  NULL::jsonb AS imp_sys_peq;

-- O impact system autoriza por membership: troca a identidade para o admin da
-- org pequena só para esta captura, e volta para a Milennials em seguida.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _param WHERE k='uid_peq'), 'role', 'authenticated')::text,
  true);

UPDATE _e626_impacts SET imp_sys_peq = public.system_pipeline_delete_impact(
  (SELECT v::uuid FROM _param WHERE k='org_peq'), 'whatsapp');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _param WHERE k='uid_mil'), 'role', 'authenticated')::text,
  true);

-- ─── BASELINE 5: ACL das 12 funções (has_function_privilege por papel) ──────
CREATE TEMP TABLE _e626_grants ON COMMIT DROP AS
SELECT p.proname AS fn,
       bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))          AS anon_x,
       bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth_x,
       bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))  AS sr_x
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'get_pipeline_stage_counts','get_custom_pipeline_stage_counts',
  'get_stage_lead_ids','get_filtered_lead_ids','get_custom_filtered_lead_ids',
  'system_pipeline_delete_impact','delete_system_pipeline',
  'custom_pipeline_delete_impact','delete_custom_pipeline',
  'bulk_move_stage','bulk_add_to_custom_pipe','get_pipeline_page')
GROUP BY p.proname;

-- ─── BASELINE 6: estado do card da sonda de bulk ────────────────────────────
CREATE TEMP TABLE _e626_bulk_antes ON COMMIT DROP AS
SELECT pe.id AS entry_id, pe.stage_id, pe.stage_key
FROM public.pipeline_entries pe
WHERE pe.pipeline_id = (SELECT v::uuid FROM _param WHERE k='pipe_sys')
  AND pe.lead_id = (SELECT v::uuid FROM _param WHERE k='lead_bulk')
  AND pe.closed_at IS NULL;

DO $$
BEGIN
  RAISE NOTICE 'baseline OK: % etapas sys, % etapas cus, % chars de página, ids(stage/filtered/custom)=%/%/%',
    (SELECT count(*) FROM _e626_counts_sys),
    (SELECT count(*) FROM _e626_counts_cus),
    (SELECT length(pg::text) FROM _e626_page_sys),
    (SELECT coalesce(array_length(ids_stage,1),0) FROM _e626_ids),
    (SELECT coalesce(array_length(ids_filtered,1),0) FROM _e626_ids),
    (SELECT coalesce(array_length(ids_custom,1),0) FROM _e626_ids);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-631 — ANTES: abre a transação, escolhe 3 orgs reais e captura
-- o BASELINE das 4 RPCs de análise de prod (resultados + ACL) antes da
-- resolução por pipeline_id.
--
-- Payload montado por scripts/ensaio-scrum631.sh:
--   ensaio-scrum631.sql (BEGIN + _e631_orgs + baselines)
--     → supabase/migrations/20270908009000_analytics_por_pipeline_id.sql
--     → scripts/ensaio-scrum631-depois.sql (paridade byte-a-byte onde a
--       semântica não mudou + deltas MEDIDOS onde mudou + sondas por
--       pipeline_id + RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
--
-- Identidade: o ensaio roda como postgres (Management API), mas as RPCs
-- autorizam por auth.uid() → request.jwt.claims aponta para um membro REAL de
-- cada org alvo antes de cada rodada. RLS: postgres bypassa — igual antes e
-- depois, então as comparações valem.
--
-- Orgs alvo (medidas 2026-09-02, maiores em entries + eventos com
-- metadata.pipeline_id + funis custom):
--   mil = Milennials           (2.814 entries, 7 funis custom)
--   rea = REALSC               (2.366 entries, 4 funis custom ativos)
--   chq = Chique Distribuidora (4.220 entries, 6 funis custom)
-- (Goletric Pinheiros/Perdizes lideram em eventos mas têm 0 membros ATIVOS —
-- as RPCs autorizam por membership ativa, então ficam de fora.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Alvos ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _e631_orgs (k text PRIMARY KEY, org_id uuid, uid uuid) ON COMMIT DROP;

INSERT INTO _e631_orgs (k, org_id, uid)
SELECT v.k, v.org_id,
  (SELECT tm.user_id FROM public.team_members tm
    WHERE tm.organization_id = v.org_id AND tm.is_active AND tm.user_id IS NOT NULL
    ORDER BY (tm.role = 'admin') DESC LIMIT 1)
FROM (VALUES
  ('mil', '6030520a-2ca7-477d-be89-55758e2cd808'::uuid),
  ('rea', 'd42fd7c1-ef29-470d-b408-541d5371e301'::uuid),
  ('chq', '38f3bea4-44c6-4732-bb20-065f547a7ed8'::uuid)
) AS v(k, org_id);

DO $$
BEGIN
  IF (SELECT count(*) FROM _e631_orgs WHERE uid IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'FAIL setup: faltou membro ativo em alguma org alvo';
  END IF;
END $$;

-- Funil custom mais povoado de cada org (sondas por pipeline_id).
CREATE TEMP TABLE _e631_custom (org_k text PRIMARY KEY, pipeline_id uuid, n_stages int) ON COMMIT DROP;
INSERT INTO _e631_custom
SELECT o.k, p.id,
  (SELECT count(*) FROM public.pipeline_stages ps WHERE ps.pipeline_id = p.id)
FROM _e631_orgs o
CROSS JOIN LATERAL (
  SELECT p.id FROM public.pipelines p
  WHERE p.organization_id = o.org_id AND p.type = 'custom' AND p.is_active
  ORDER BY (SELECT count(*) FROM public.pipeline_entries pe WHERE pe.pipeline_id = p.id) DESC
  LIMIT 1
) p;

-- ─── ACL baseline das 4 assinaturas legadas ─────────────────────────────────
CREATE TEMP TABLE _e631_grants (fn text PRIMARY KEY, anon_x bool, auth_x bool, sr_x bool) ON COMMIT DROP;
INSERT INTO _e631_grants
SELECT p.proname,
  bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')),
  bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('get_funnel_conversion', 'get_pipeline_velocity',
                    'get_sales_cycle_analysis', 'get_analytics_pipeline_metrics')
GROUP BY p.proname;

-- ─── Baselines de resultado ─────────────────────────────────────────────────
-- Janela fixa 2026-06-01 → 2026-09-01 (cobre a era do metadata.pipeline_id).
CREATE TEMP TABLE _e631_fc (org_k text, slug text, stage_id uuid, stage_name text,
  stage_order int, total_entered bigint, total_current bigint, conversion_rate numeric) ON COMMIT DROP;
CREATE TEMP TABLE _e631_vel (org_k text, slug text, j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _e631_sc (org_k text, slug text, from_stage text, to_stage text,
  avg_hours numeric, median_hours numeric, transition_count bigint) ON COMMIT DROP;
CREATE TEMP TABLE _e631_met (org_k text, slug text, j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _e631_report (seq serial, line text) ON COMMIT DROP;

DO $$
DECLARE
  o record;
  s text;
  v_start timestamptz := '2026-06-01+00';
  v_end   timestamptz := '2026-09-01+00';
BEGIN
  FOR o IN SELECT * FROM _e631_orgs ORDER BY k LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', o.uid, 'role', 'authenticated')::text, true);

    FOREACH s IN ARRAY ARRAY['whatsapp', 'confirmacao', 'propostas'] LOOP
      INSERT INTO _e631_fc
      SELECT o.k, s, f.* FROM public.get_funnel_conversion(s, v_start, v_end) f;

      INSERT INTO _e631_vel
      VALUES (o.k, s, public.get_pipeline_velocity(s, v_start, v_end));

      INSERT INTO _e631_sc
      SELECT o.k, s, c.* FROM public.get_sales_cycle_analysis(s, v_start, v_end, o.org_id) c;

      INSERT INTO _e631_met
      VALUES (o.k, s, public.get_analytics_pipeline_metrics(o.org_id, '2026-06-01', '2026-09-01', s, NULL));
    END LOOP;

    -- Recortes sem filtro de funil ("__all__").
    INSERT INTO _e631_vel
    VALUES (o.k, '__all__', public.get_pipeline_velocity(NULL, v_start, v_end));

    INSERT INTO _e631_sc
    SELECT o.k, '__all__', c.* FROM public.get_sales_cycle_analysis(NULL, v_start, v_end, o.org_id) c;

    INSERT INTO _e631_met
    VALUES (o.k, '__all__', public.get_analytics_pipeline_metrics(o.org_id, '2026-06-01', '2026-09-01', NULL, NULL));
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-620 — DEPOIS: métricas do delta + RAISE 'ENSAIO_OK' (aborta).
-- As asserções A1/A2/A3 já rodaram DENTRO do script de verdade — se alguma
-- falhasse, a transação teria abortado antes de chegar aqui.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_won bigint; v_lost bigint; v_mb bigint; v_mh bigint;
  v_open bigint; v_sug_novas bigint; v_fila_total bigint;
BEGIN
  -- Deltas contra o snapshot _e620_pre (só linhas que o script mudou).
  SELECT
    count(*) FILTER (WHERE ps.stage_role = 'won'  AND pre.stage_role = 'open'),
    count(*) FILTER (WHERE ps.stage_role = 'lost' AND pre.stage_role = 'open'),
    count(*) FILTER (WHERE ps.stage_role = 'meeting_booked' AND pre.stage_role = 'open'),
    count(*) FILTER (WHERE ps.stage_role = 'meeting_held'  AND pre.stage_role = 'open'),
    count(*) FILTER (WHERE ps.stage_role = 'open' AND ps.stage_role_reviewed_at IS NOT NULL
                       AND pre.stage_role_reviewed_at IS NULL AND ps.suggested_stage_role IS NULL),
    count(*) FILTER (WHERE ps.suggested_stage_role IS NOT NULL AND pre.suggested_stage_role IS NULL)
  INTO v_won, v_lost, v_mb, v_mh, v_open, v_sug_novas
  FROM public.pipeline_stages ps
  JOIN _e620_pre pre ON pre.id = ps.id;

  SELECT count(*) INTO v_fila_total
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
  WHERE ps.is_active AND ps.suggested_stage_role IS NOT NULL
    AND ps.stage_role = 'open' AND ps.stage_role_reviewed_at IS NULL;

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-620 won=% lost=% meeting_booked=% meeting_held=% open_governado=% sugestoes_novas=% fila_total_master=%',
    v_won, v_lost, v_mb, v_mh, v_open, v_sug_novas, v_fila_total;
END $$;

ROLLBACK;

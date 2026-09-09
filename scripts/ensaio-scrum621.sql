-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-621 — ANTES: abre a transação, controle vazio e snapshot.
--
-- Payload montado por scripts/ensaio-scrum621.sh:
--   ensaio-scrum621.sql (BEGIN + controle + snapshot)
--     → supabase/migrations/20270908001000_inversao_do_silo_custom.sql
--       (o ARQUIVO DE VERDADE, concatenado — não é cópia)
--     → ensaio-scrum621-depois.sql (sondas I/U/D + workflow + dispatch +
--       RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ─────────────────────────────────────────────────────────
DO $$
DECLARE v_cpe bigint; v_cp bigint; v_probe int;
BEGIN
  SELECT count(*) INTO v_cpe FROM public.custom_pipe_entries;
  SELECT count(*) INTO v_cp  FROM public.custom_pipelines;
  IF v_cpe = 0 OR v_cp = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: cpe=% cp=% — sem massa, o ensaio não prova nada', v_cpe, v_cp;
  END IF;

  -- Precisa existir ao menos 1 org com funil custom ativo, >=2 etapas ativas e
  -- 1 team_member — é dela que as sondas do depois tiram os ids.
  SELECT count(*) INTO v_probe
  FROM public.custom_pipelines cp
  WHERE cp.is_active
    AND (SELECT count(*) FROM public.custom_pipeline_stages s
          WHERE s.pipeline_id = cp.id AND s.is_active) >= 2
    AND EXISTS (SELECT 1 FROM public.team_members tm
                 WHERE tm.organization_id = cp.organization_id AND tm.is_active);
  IF v_probe = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: nenhum funil custom serve de sonda (2+ etapas e member ativo)';
  END IF;
  RAISE NOTICE 'controle vazio OK: % cards, % funis, % funis-sonda', v_cpe, v_cp, v_probe;
END $$;

-- ─── SNAPSHOT (para os deltas do depois) ────────────────────────────────────
CREATE TEMP TABLE _e621_pre ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.custom_pipe_entries)       AS cpe_total,
  (SELECT count(*) FROM public.custom_pipelines)          AS cp_total,
  (SELECT count(*) FROM public.scheduled_pipe_messages)   AS spm_total,
  (SELECT count(*) FROM public.workflow_executions)       AS wfx_total;


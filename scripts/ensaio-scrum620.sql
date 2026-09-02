-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-620 — ANTES: abre a transação, controle vazio e snapshot.
--
-- Primeira parte do payload montado por scripts/ensaio-scrum620.sh:
--   ensaio-scrum620.sql (BEGIN + controle + snapshot)
--     → scripts/scrum620-stage-roles.sql   (o ARQUIVO DE VERDADE, concatenado)
--     → ensaio-scrum620-depois.sql         (contagens + RAISE 'ENSAIO_OK' + ROLLBACK)
--
-- NADA é aplicado: o "depois" termina em RAISE EXCEPTION 'ENSAIO_OK ...'
-- (aborta a transação com as métricas na mensagem) e a última instrução é
-- ROLLBACK. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ─────────────────────────────────────────────────────────
DO $$
DECLARE v_custom bigint;
BEGIN
  SELECT count(*) INTO v_custom
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
  WHERE ps.is_active;
  IF v_custom = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: 0 etapas custom ativas — sem massa, o ensaio não prova nada';
  END IF;
  RAISE NOTICE 'controle vazio OK: % etapas custom ativas', v_custom;
END $$;

-- ─── SNAPSHOT das colunas de governança (para o delta do depois) ────────────
CREATE TEMP TABLE _e620_pre ON COMMIT DROP AS
SELECT ps.id, ps.stage_role, ps.suggested_stage_role,
       ps.stage_role_reviewed_at, ps.stage_role_suggestion_source
FROM public.pipeline_stages ps
JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
WHERE ps.is_active;

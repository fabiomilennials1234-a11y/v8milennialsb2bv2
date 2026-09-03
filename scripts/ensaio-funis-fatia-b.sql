-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO FATIA B (épico Funil é Funil — campanhas e disparos) — ANTES:
-- abre a transação e captura o baseline de `campanhas` e `blast_plans` antes
-- do destino canônico por pipeline_id.
--
-- Payload montado por scripts/ensaio-funis-fatia-b.sh:
--   ensaio-funis-fatia-b.sql (BEGIN + baselines)
--     → supabase/migrations/20270917000000_campanha_e_disparo_por_pipeline_id.sql
--       (DDL + backfill + asserções A1–A5 embutidas)
--     → scripts/ensaio-funis-fatia-b-depois.sql (deltas medidos + provas de
--       resolução + RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _efb_antes ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.campanhas)                                   AS campanhas_total,
  (SELECT count(*) FROM public.campanhas WHERE objective <> 'livre')        AS campanhas_obj_fixo,
  (SELECT count(*) FROM public.campanhas
    WHERE objective = 'livre' AND free_target_pipe IS NOT NULL
      AND free_target_stage IS NOT NULL)                                    AS campanhas_livre_com_destino,
  (SELECT count(*) FROM public.blast_plans)                                 AS bp_total,
  (SELECT count(*) FROM public.blast_plans
    WHERE COALESCE(source->>'funnelKind','system') <> 'all'
      AND source->>'context' = 'disparo' AND source ? 'stageKey')           AS bp_funil_unico,
  (SELECT count(*) FROM public.blast_plans WHERE post_send_target IS NOT NULL) AS bp_com_destino;

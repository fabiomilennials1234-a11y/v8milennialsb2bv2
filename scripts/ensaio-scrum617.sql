-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-617 — ANTES: abre a transação, snapshot completo e controles.
--
-- Prod ainda NÃO tem a 20270906001000 (SCRUM-616): o ensaio roda as DUAS em
-- sequência. Este arquivo é a PRIMEIRA parte do payload montado por
-- scripts/ensaio-scrum617.sh:
--
--   ensaio-scrum617.sql (BEGIN + snapshot + vermelho)
--     → supabase/migrations/20270906001000_etapas_ganham_fk_ao_funil.sql
--     → supabase/migrations/20270906002000_cards_apontam_etapa_por_uuid.sql
--     → ensaio-scrum617-verde.sql   (asserções + sondas pipe_* e sync custom)
--     → supabase/migrations/rollback/20270906002000_...sql
--     → supabase/migrations/rollback/20270906001000_...sql
--     → ensaio-scrum617-depois.sql  (estado revertido + RAISE 'ENSAIO_OK')
--     → ROLLBACK
--
-- NADA é aplicado: o "depois" termina em RAISE EXCEPTION 'ENSAIO_OK ...' e a
-- última instrução é ROLLBACK. NÃO RODAR sem janela aprovada pelo CTO — o
-- ensaio segura locks reais em pipeline_entries/pipeline_stages enquanto roda.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ─────────────────────────────────────────────────────────
DO $$
DECLARE v_ent bigint; v_sys bigint; v_custom bigint;
BEGIN
  SELECT count(*) INTO v_ent    FROM public.pipeline_entries;
  SELECT count(*) INTO v_sys    FROM public.pipeline_stages;
  SELECT count(*) INTO v_custom FROM public.custom_pipeline_stages;
  IF v_ent = 0 OR v_sys = 0 OR v_custom = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: entries=% sistema=% custom=% — sem massa, o ensaio não prova nada', v_ent, v_sys, v_custom;
  END IF;
  RAISE NOTICE 'controle vazio OK: % entries, % etapas de sistema, % etapas custom', v_ent, v_sys, v_custom;
END $$;

-- ─── SNAPSHOT de pipeline_entries (identidade + espelho) ───────────────────
CREATE TEMP TABLE _e617_pre ON COMMIT DROP AS
SELECT id, organization_id, pipeline_id, stage_key
FROM public.pipeline_entries;

-- ─── Contagens de referência: emula a resolução PRÉ-616 ────────────────────
-- (sistema por org+slug→pipeline_type; custom por custom_pipeline_stages;
--  recuperáveis por uuid-key nos dois mundos)
CREATE TEMP TABLE _e617_counts ON COMMIT DROP AS
WITH ent AS (
  SELECT pe.id, pe.organization_id, pe.pipeline_id, pe.stage_key, pip.type, pip.slug
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip ON pip.id = pe.pipeline_id
), marcado AS (
  SELECT e.*,
    CASE
      WHEN e.type = 'system' THEN EXISTS (
        SELECT 1 FROM public.pipeline_stages ps
        WHERE ps.organization_id = e.organization_id
          AND ps.pipeline_type   = e.slug
          AND ps.stage_key       = e.stage_key)
      ELSE EXISTS (
        SELECT 1 FROM public.custom_pipeline_stages cs
        WHERE cs.pipeline_id = e.pipeline_id
          AND cs.stage_key   = e.stage_key)
    END AS resolve,
    (e.stage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND (
       EXISTS (SELECT 1 FROM public.custom_pipeline_stages cs
                WHERE cs.id = e.stage_key::uuid AND cs.pipeline_id = e.pipeline_id)
       OR (e.type = 'system' AND EXISTS (
             SELECT 1 FROM public.pipeline_stages ps
             WHERE ps.id = e.stage_key::uuid
               AND ps.organization_id = e.organization_id
               AND ps.pipeline_type   = e.slug))
     )) AS recuperavel_uuid
  FROM ent e
)
SELECT
  (SELECT count(*) FROM public.pipeline_entries)                      AS total,
  count(*) FILTER (WHERE resolve)                                     AS resolviveis,
  count(*) FILTER (WHERE NOT resolve AND recuperavel_uuid)            AS recuperaveis_uuid,
  count(*) FILTER (WHERE NOT resolve AND NOT recuperavel_uuid)        AS orfas
FROM marcado;

DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM _e617_counts;
  RAISE NOTICE 'snapshot: % entries · % resolvíveis · % recuperáveis por uuid-key · % órfãs',
    c.total, c.resolviveis, c.recuperaveis_uuid, c.orfas;
END $$;

-- ─── VERMELHO: o estado atual ainda é o velho (nenhuma das duas aplicada) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pipeline_stages'::regclass
                    AND conname = 'pipeline_stages_pipeline_type_check') THEN
    RAISE EXCEPTION 'VERMELHO FALHOU: CHECK dos 5 tipos já não existe — 20270906001000 já aplicada?';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pipeline_entries'
                AND column_name = 'stage_id') THEN
    RAISE EXCEPTION 'VERMELHO FALHOU: pipeline_entries.stage_id já existe — 20270906002000 já aplicada?';
  END IF;
  IF (SELECT relkind FROM pg_class
       WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'VERMELHO FALHOU: custom_pipeline_stages não é tabela';
  END IF;
  RAISE NOTICE 'vermelho OK: estado pré-migrations confirmado';
END $$;

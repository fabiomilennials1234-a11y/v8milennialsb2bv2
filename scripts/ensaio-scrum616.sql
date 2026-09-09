-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-616 — ANTES: abre a transação, snapshot completo e controles.
--
-- Este arquivo é a PRIMEIRA parte do payload montado por
-- scripts/ensaio-scrum616.sh:
--
--   ensaio-scrum616.sql (BEGIN + snapshot)
--     → supabase/migrations/20270906001000_etapas_ganham_fk_ao_funil.sql
--     → ensaio-scrum616-verde.sql   (asserções pós-migration + sonda INSTEAD OF)
--     → supabase/migrations/rollback/20270906001000_...sql
--     → ensaio-scrum616-depois.sql  (asserções pós-rollback + RAISE 'ENSAIO_OK')
--     → ROLLBACK
--
-- NADA é aplicado: o "depois" termina em RAISE EXCEPTION 'ENSAIO_OK ...' (aborta
-- a transação com as métricas na mensagem) e a última instrução é ROLLBACK.
-- NÃO RODAR sem janela aprovada pelo CTO — o ensaio é leitura transacional, mas
-- segura locks reais durante a execução.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ─────────────────────────────────────────────────────────
DO $$
DECLARE v_custom bigint; v_sys bigint;
BEGIN
  SELECT count(*) INTO v_custom FROM public.custom_pipeline_stages;
  SELECT count(*) INTO v_sys    FROM public.pipeline_stages;
  IF v_custom = 0 OR v_sys = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: custom=% sistema=% — sem massa, o ensaio não prova preservação', v_custom, v_sys;
  END IF;
  RAISE NOTICE 'controle vazio OK: % etapas custom, % etapas de sistema', v_custom, v_sys;
END $$;

-- ─── SNAPSHOT integral das etapas custom (linha a linha) ───────────────────
CREATE TEMP TABLE _e616_pre ON COMMIT DROP AS
SELECT * FROM public.custom_pipeline_stages;

-- ─── SNAPSHOT da ordem das etapas de sistema ───────────────────────────────
CREATE TEMP TABLE _e616_sys_pre ON COMMIT DROP AS
SELECT id, organization_id, pipeline_type, is_active, position, created_at
FROM public.pipeline_stages;

-- ─── Contagens de referência ───────────────────────────────────────────────
CREATE TEMP TABLE _e616_counts ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM _e616_pre)                                             AS custom_total,
  (SELECT count(*) FROM _e616_sys_pre)                                         AS sys_total,
  (SELECT count(*) FROM _e616_sys_pre
    WHERE pipeline_type IN ('upsell_base','upsell_gestao'))                    AS upsell_total,
  (SELECT count(*) FROM _e616_sys_pre s
    WHERE s.pipeline_type IN ('whatsapp','confirmacao','propostas') AND s.is_active
      AND NOT EXISTS (SELECT 1 FROM public.pipelines p
                       WHERE p.organization_id = s.organization_id
                         AND p.slug = s.pipeline_type AND p.type = 'system'))  AS orfas_ativas;

-- ─── VERMELHO: o estado atual ainda é o velho ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pipeline_stages'::regclass
                    AND conname = 'pipeline_stages_pipeline_type_check') THEN
    RAISE EXCEPTION 'VERMELHO FALHOU: o CHECK dos 5 tipos já não existe — migration já aplicada?';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pipeline_stages'
                AND column_name = 'pipeline_id') THEN
    RAISE EXCEPTION 'VERMELHO FALHOU: pipeline_stages.pipeline_id já existe — migration já aplicada?';
  END IF;
  IF (SELECT relkind FROM pg_class
       WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'VERMELHO FALHOU: custom_pipeline_stages não é tabela';
  END IF;
  RAISE NOTICE 'vermelho OK: estado pré-migration confirmado';
END $$;

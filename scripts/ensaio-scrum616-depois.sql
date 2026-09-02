-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-616 — DEPOIS: prova que o rollback devolve o estado original e
-- encerra com RAISE EXCEPTION 'ENSAIO_OK ...' (aborta a transação de propósito,
-- carregando as métricas na mensagem). O ROLLBACK final do payload é cinto.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Estado estrutural revertido ───────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class
       WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: custom_pipeline_stages não voltou a ser tabela';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pipeline_stages'
                AND column_name = 'pipeline_id') THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: pipeline_stages.pipeline_id sobreviveu ao rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pipeline_stages'::regclass
                    AND conname = 'pipeline_stages_pipeline_type_check') THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: CHECK dos 5 tipos não voltou';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'reorder_pipeline_stages') THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: reorder_pipeline_stages sobreviveu ao rollback';
  END IF;
END $$;

-- ─── Dados revertidos: linha a linha (exceto position/updated_at, perda
--     documentada no cabeçalho do rollback) ─────────────────────────────────
DO $$
DECLARE v_diff bigint; v_custom bigint; v_sys bigint; c record;
BEGIN
  SELECT count(*) INTO v_diff FROM (
    SELECT id, organization_id, pipeline_id, stage_key, name, color, is_active,
           is_final_positive, is_final_negative, target_pipeline_id,
           target_stage_id, target_pipe_type, target_stage_key, created_at,
           checklist_template_id, stage_role, suggested_stage_role,
           stage_role_suggested_at, stage_role_suggestion_source,
           stage_role_reviewed_at, stage_role_reviewed_by, requires_sale_value
    FROM _e616_pre
    EXCEPT
    SELECT id, organization_id, pipeline_id, stage_key, name, color, is_active,
           is_final_positive, is_final_negative, target_pipeline_id,
           target_stage_id, target_pipe_type, target_stage_key, created_at,
           checklist_template_id, stage_role, suggested_stage_role,
           stage_role_suggested_at, stage_role_suggestion_source,
           stage_role_reviewed_at, stage_role_reviewed_by, requires_sale_value
    FROM public.custom_pipeline_stages
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: % linhas custom divergem do snapshot após rollback', v_diff;
  END IF;

  SELECT count(*) INTO v_custom FROM public.custom_pipeline_stages;
  SELECT count(*) INTO v_sys    FROM public.pipeline_stages;
  SELECT * INTO c FROM _e616_counts;
  IF v_custom <> c.custom_total OR v_sys <> c.sys_total THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: contagens divergem (custom % vs %, sistema % vs %)',
      v_custom, c.custom_total, v_sys, c.sys_total;
  END IF;

  -- Sucesso: aborta DE PROPÓSITO com as métricas do ensaio na mensagem.
  RAISE EXCEPTION
    'ENSAIO_OK SCRUM-616 — migration+rollback provados contra prod: % etapas custom migradas e revertidas · % etapas de sistema (% upsell ficam NULL, % órfãs ativas AUTOTEK ficam NULL) · view+INSTEAD OF I/U/D OK · reorder RPC OK · uniques OK · nada foi aplicado (transação abortada)',
    c.custom_total, c.sys_total, c.upsell_total, c.orfas_ativas;
END $$;

ROLLBACK;

-- Trilha 3.A Fase A3 — Migration: converte rules ativas em wrapper workflows
--
-- Estratégia segura:
-- 1. Loop em pipe_dispatch_rules ativas + campanha_dispatch_rules ativas
-- 2. Pra cada rule, chama conversor (gera workflow wrapper)
-- 3. Skip rules que JÁ têm wrapper (idempotente)
-- 4. Reporta count via NOTICE
--
-- Pós-migration: dispatchers (A2 deployed) automaticamente cancelam scheduled
-- items dessas rules, workflow engine assume processamento via wrappers.
--
-- Rollback: DELETE FROM workflows WHERE wrapper_for IS NOT NULL e wrapper_source_id IN (...)
-- Rules originais ficam intactas, podem ser reativadas a qualquer momento.

DO $$
DECLARE
  v_rule_id uuid;
  v_workflow_id uuid;
  v_pipe_count int := 0;
  v_campaign_count int := 0;
  v_skipped int := 0;
BEGIN
  -- Pipe rules ativas
  FOR v_rule_id IN
    SELECT pdr.id FROM public.pipe_dispatch_rules pdr
    WHERE pdr.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.wrapper_for = 'pipe_rule' AND w.wrapper_source_id = pdr.id
      )
  LOOP
    BEGIN
      v_workflow_id := public.convert_pipe_rule_to_workflow(v_rule_id);
      v_pipe_count := v_pipe_count + 1;
      RAISE NOTICE 'Converted pipe_rule % → workflow %', v_rule_id, v_workflow_id;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Failed to convert pipe_rule %: %', v_rule_id, SQLERRM;
    END;
  END LOOP;

  -- Campaign rules ativas
  FOR v_rule_id IN
    SELECT cdr.id FROM public.campanha_dispatch_rules cdr
    WHERE cdr.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.wrapper_for = 'campaign_rule' AND w.wrapper_source_id = cdr.id
      )
  LOOP
    BEGIN
      v_workflow_id := public.convert_campaign_rule_to_workflow(v_rule_id);
      v_campaign_count := v_campaign_count + 1;
      RAISE NOTICE 'Converted campaign_rule % → workflow %', v_rule_id, v_workflow_id;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Failed to convert campaign_rule %: %', v_rule_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Trilha 3.A A3 done: pipe=%, campaign=%, skipped=%',
    v_pipe_count, v_campaign_count, v_skipped;
END $$;

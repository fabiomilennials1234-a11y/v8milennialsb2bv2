-- 20261124000003_merge_funnel_contiguous_meeting_stages.sql
--
-- Fix do merge (ADR-0004): coloca as etapas de reunião CONTÍGUAS após `agendado`
-- no funil mergeado, em vez de no fim (decisão revista pelo CTO — "lado a lado
-- pra fazer sentido o merge"). Scoped Milennials. Idempotente o suficiente.
--
-- agendado=6 (fica) → remarcar=7 → compareceu=8 → nao_compareceu=9.
-- Demais stages com position >= 7 são empurrados +3 (preserva ordem relativa).

DO $$
DECLARE
  v_org uuid := '6030520a-2ca7-477d-be89-55758e2cd808';
  v_remarcar_pos int;
BEGIN
  -- Guard de idempotência: se remarcar já está em 7, nada a fazer.
  SELECT position INTO v_remarcar_pos FROM public.pipeline_stages
    WHERE organization_id = v_org AND pipeline_type = 'whatsapp' AND stage_key = 'remarcar';
  IF v_remarcar_pos = 7 THEN
    RAISE NOTICE 'reorder já aplicado (remarcar=7)';
    RETURN;
  END IF;

  -- 1) Empurra +3 todas as stages a partir da posição 7, EXCETO as 3 de reunião.
  UPDATE public.pipeline_stages
  SET position = position + 3, updated_at = NOW()
  WHERE organization_id = v_org
    AND pipeline_type = 'whatsapp'
    AND position >= 7
    AND stage_key NOT IN ('remarcar', 'compareceu', 'nao_compareceu');

  -- 2) Encaixa as 3 de reunião logo após `agendado` (6).
  UPDATE public.pipeline_stages SET position = 7, updated_at = NOW()
    WHERE organization_id = v_org AND pipeline_type = 'whatsapp' AND stage_key = 'remarcar';
  UPDATE public.pipeline_stages SET position = 8, updated_at = NOW()
    WHERE organization_id = v_org AND pipeline_type = 'whatsapp' AND stage_key = 'compareceu';
  UPDATE public.pipeline_stages SET position = 9, updated_at = NOW()
    WHERE organization_id = v_org AND pipeline_type = 'whatsapp' AND stage_key = 'nao_compareceu';
END $$;

-- 20261124000002_merge_agendamentos_data_migration.sql
--
-- Slice 6 do merge Agendamentos → Oportunidades (ADR-0004, issue #722).
-- ⚠️ MIGRAÇÃO DESTRUTIVA — repointa/reescreve pipeline_entries. Scoped Milennials.
-- Espelha as regras puras testadas em src/modules/pipelines/lib/confirmacao-migration.ts
-- (mapConfirmacaoStage + resolveDedup).
--
-- Roda atômica (Management API envolve em transação). Backup criado antes.

DO $$
DECLARE
  v_org  uuid := '6030520a-2ca7-477d-be89-55758e2cd808';
  v_wpp  uuid;
  v_conf uuid;
  v_lost text;
BEGIN
  SELECT id INTO v_wpp  FROM public.pipelines WHERE slug='whatsapp'    AND type='system' AND organization_id=v_org;
  SELECT id INTO v_conf FROM public.pipelines WHERE slug='confirmacao' AND type='system' AND organization_id=v_org;
  SELECT stage_key INTO v_lost FROM public.pipeline_stages
    WHERE organization_id=v_org AND pipeline_type='whatsapp' AND is_final_negative ORDER BY position LIMIT 1;

  IF v_wpp IS NULL OR v_conf IS NULL THEN
    RAISE EXCEPTION 'pipeline whatsapp/confirmacao não encontrado para a org %', v_org;
  END IF;

  -- ── Backup (rollback manual se necessário) ──────────────────
  DROP TABLE IF EXISTS public._backup_merge_agendamentos_milennials;
  CREATE TABLE public._backup_merge_agendamentos_milennials AS
    SELECT * FROM public.pipeline_entries
    WHERE organization_id=v_org AND pipeline_id IN (v_wpp, v_conf);

  -- ── Step 1: DEDUP (lead em whatsapp E confirmacao) ──────────
  -- Confirmacao vence: aplica stage+metadata da confirmacao no row de whatsapp,
  -- depois deleta o row de confirmacao (evita colisão UNIQUE no repoint).
  UPDATE public.pipeline_entries w
  SET stage_key = CASE
        WHEN c.stage_key IN ('reuniao_marcada','confirmar_d5','confirmar_d3','confirmar_d2','confirmar_d1','confirmacao_no_dia') THEN 'agendado'
        WHEN c.stage_key = 'remarcar'   THEN 'remarcar'
        WHEN c.stage_key = 'compareceu' THEN 'compareceu'
        WHEN c.stage_key = 'perdido'    THEN v_lost
        ELSE 'agendado'
      END,
      metadata = (w.metadata || c.metadata) || jsonb_build_object(
        'confirmation_status',
        CASE WHEN c.stage_key = 'perdido' THEN NULL
             WHEN (c.metadata->>'is_confirmed')::boolean IS TRUE THEN 'confirmado'
             ELSE 'pendente' END,
        'is_confirmed', COALESCE((c.metadata->>'is_confirmed')::boolean, false)
      )
  FROM public.pipeline_entries c
  WHERE w.organization_id=v_org AND w.pipeline_id=v_wpp
    AND c.organization_id=v_org AND c.pipeline_id=v_conf
    AND c.lead_id = w.lead_id;

  DELETE FROM public.pipeline_entries c
  WHERE c.organization_id=v_org AND c.pipeline_id=v_conf
    AND EXISTS (
      SELECT 1 FROM public.pipeline_entries w
      WHERE w.organization_id=v_org AND w.pipeline_id=v_wpp AND w.lead_id=c.lead_id
    );

  -- ── Step 2: REPOINT (confirmacao-only) → whatsapp + remap stage ──
  UPDATE public.pipeline_entries c
  SET pipeline_id = v_wpp,
      stage_key = CASE
        WHEN c.stage_key IN ('reuniao_marcada','confirmar_d5','confirmar_d3','confirmar_d2','confirmar_d1','confirmacao_no_dia') THEN 'agendado'
        WHEN c.stage_key = 'remarcar'   THEN 'remarcar'
        WHEN c.stage_key = 'compareceu' THEN 'compareceu'
        WHEN c.stage_key = 'perdido'    THEN v_lost
        ELSE 'agendado'
      END,
      metadata = c.metadata || jsonb_build_object(
        'confirmation_status',
        CASE WHEN c.stage_key = 'perdido' THEN NULL
             WHEN (c.metadata->>'is_confirmed')::boolean IS TRUE THEN 'confirmado'
             ELSE 'pendente' END,
        'is_confirmed', COALESCE((c.metadata->>'is_confirmed')::boolean, false)
      )
  WHERE c.organization_id=v_org AND c.pipeline_id=v_conf;

  RAISE NOTICE 'Merge Agendamentos→Oportunidades concluído para org %', v_org;
END $$;

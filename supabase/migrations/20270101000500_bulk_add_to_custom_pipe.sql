-- 20270101000500_bulk_add_to_custom_pipe.sql
--
-- NOTA versao: renumerada de 20261223000000 -> 20270101000500 porque a versao
-- 20261223000000 ja estava ocupada no tracker de PROD por outra migration
-- (torque_mcp_s2_policies). Escolhida acima do max do tracker para nunca colidir.
--
-- FEATURE: mover leads em massa (BulkActionBar -> "Mover") para um FUNIL CUSTOM
-- (custom_pipelines), alem dos 3 pipes de sistema (whatsapp/confirmacao/propostas).
--
-- Espelha EXATAMENTE o idioma de public.bulk_move_stage
-- (20261221000000_fix_bulk_rpcs_master_bypass.sql):
--   - master bypass via public.is_master_user()
--   - membro: pina a propria org via team_members (user_id=auth.uid() AND is_active)
--   - resolucao de org POR LEAD (nunca confia em input de org) -> multi-tenant seguro
--     e correto para selecoes cross-org do master.
--
-- NOTA search_path: usa `SET search_path = public, pg_temp` (nao ''), pelo MESMO
-- motivo do arquivo original. O INSERT/UPDATE em custom_pipe_entries dispara
-- triggers que referenciam tabelas SEM qualificar e NAO definem search_path
-- proprio:
--   - trg_custom_pipe_entries_updated_at -> update_updated_at_column()
--   - trg_workflow_custom_pipe_stage_change (workflow stage_change)
-- Com search_path='' herdado, esses triggers falhariam com 42P01. Pinar em
-- public, pg_temp resolve sem alterar os triggers (hot-path).
--
-- custom_pipe_entries tem UNIQUE(pipeline_id, lead_id): o ON CONFLICT torna a
-- operacao um upsert (lead ja no funil vira update de etapa, sem erro de dup).
-- assigned_to fica NULL no insert em massa (opcional).

CREATE OR REPLACE FUNCTION public.bulk_add_to_custom_pipe(
  p_lead_ids UUID[],
  p_pipeline_id UUID,
  p_stage_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_master  boolean := public.is_master_user();
  v_member_org uuid;
  v_lead_id    uuid;
  v_lead_org   uuid;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Org do lead + autorizacao (membro: so a propria org; master: qualquer org)
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- Funil custom alvo deve pertencer a org do lead e estar ativo
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipelines cp
      WHERE cp.id = p_pipeline_id
        AND cp.organization_id = v_lead_org
        AND cp.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    -- Etapa alvo deve pertencer ao funil
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipeline_stages cps
      WHERE cps.id = p_stage_id
        AND cps.pipeline_id = p_pipeline_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.custom_pipe_entries (
      organization_id, pipeline_id, lead_id, stage_id, entered_at, stage_changed_at
    ) VALUES (
      v_lead_org, p_pipeline_id, v_lead_id, p_stage_id, now(), now()
    )
    ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
      stage_id = EXCLUDED.stage_id,
      stage_changed_at = now(),
      updated_at = now();
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_add_to_custom_pipe(UUID[], UUID, UUID) TO authenticated;

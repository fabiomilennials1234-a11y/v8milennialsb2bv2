-- Rollback de 20271006000000_front_escreve_sem_espelhos.sql
-- Restaura os quatro adaptadores exatamente como definidos antes da SCRUM-673.

DROP TRIGGER IF EXISTS trg_sync_lead_fields_to_pipeline_entries ON public.leads;
DROP FUNCTION IF EXISTS public.sync_lead_fields_to_pipeline_entries();

CREATE OR REPLACE FUNCTION public.fn_entrada_sistema_atualizar(
  p_entry_id uuid,
  p_patch    jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org  uuid;
  v_meta jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.pipeline_entries WHERE id = p_entry_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_sistema_atualizar: entrada % não existe', p_entry_id;
  END IF;

  -- Tenancy só do que o patch de fato traz.
  IF p_patch ? 'pre_sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'pre_sale_responsible_id','')::uuid, v_org, 'pre_sale_responsible_id');
  END IF;
  IF p_patch ? 'sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'sale_responsible_id','')::uuid, v_org, 'sale_responsible_id');
  END IF;

  -- As chaves de coluna saem do patch; o RESTO é metadata, mesclado por cima do
  -- que já existe (nunca sobrescrevendo o objeto inteiro — é assim que campanha
  -- e responsável se perdem).
  v_meta := p_patch - 'stage_key' - 'notes' - 'closed_at' - 'assigned_to';

  UPDATE public.pipeline_entries pe SET
    stage_key   = CASE WHEN p_patch ? 'stage_key'
                       THEN p_patch->>'stage_key' ELSE pe.stage_key END,
    notes       = CASE WHEN p_patch ? 'notes'
                       THEN p_patch->>'notes' ELSE pe.notes END,
    closed_at   = CASE WHEN p_patch ? 'closed_at'
                       THEN NULLIF(p_patch->>'closed_at','')::timestamptz ELSE pe.closed_at END,
    -- Presença da CHAVE decide, não o valor: `{"assigned_to": null}` desatribui
    -- de propósito, e um patch sem a chave não encosta no dono do card.
    assigned_to = CASE WHEN p_patch ? 'assigned_to'
                       THEN NULLIF(p_patch->>'assigned_to','')::uuid ELSE pe.assigned_to END,
    metadata    = CASE WHEN v_meta = '{}'::jsonb
                       THEN pe.metadata
                       ELSE COALESCE(pe.metadata, '{}'::jsonb) || v_meta END,
    updated_at  = now()
  WHERE pe.id = p_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_entrada_custom_atualizar(
  p_entry_id uuid,
  p_patch    jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org       uuid;
  v_stage_id  uuid;
  v_stage_key text;
  v_meta      jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.pipeline_entries WHERE id = p_entry_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_custom_atualizar: entrada % não existe', p_entry_id;
  END IF;

  IF p_patch ? 'pipeline_id' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipelines
                    WHERE id = NULLIF(p_patch->>'pipeline_id','')::uuid AND type = 'custom') THEN
      RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom', p_patch->>'pipeline_id';
    END IF;
  END IF;

  IF p_patch ? 'pre_sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'pre_sale_responsible_id','')::uuid, v_org, 'pre_sale_responsible_id');
  END IF;
  IF p_patch ? 'sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'sale_responsible_id','')::uuid, v_org, 'sale_responsible_id');
  END IF;

  -- Invariante 2 de novo: quem manda `stage_id` ganha `stage_key` junto, senão
  -- os AFTER ... OF stage_key não disparam e a movimentação vira invisível para
  -- disparo, workflow, checklist e história.
  IF p_patch ? 'stage_id' THEN
    v_stage_id := NULLIF(p_patch->>'stage_id','')::uuid;
    SELECT ps.stage_key INTO v_stage_key FROM public.pipeline_stages ps WHERE ps.id = v_stage_id;
  END IF;

  v_meta := p_patch - 'pipeline_id' - 'lead_id' - 'stage_id' - 'deal_id'
                    - 'assigned_to' - 'notes' - 'entered_at' - 'stage_changed_at';

  UPDATE public.pipeline_entries pe SET
    pipeline_id      = CASE WHEN p_patch ? 'pipeline_id'
                            THEN NULLIF(p_patch->>'pipeline_id','')::uuid ELSE pe.pipeline_id END,
    lead_id          = CASE WHEN p_patch ? 'lead_id'
                            THEN NULLIF(p_patch->>'lead_id','')::uuid ELSE pe.lead_id END,
    stage_id         = CASE WHEN p_patch ? 'stage_id' THEN v_stage_id ELSE pe.stage_id END,
    stage_key        = CASE WHEN p_patch ? 'stage_id'
                            THEN COALESCE(v_stage_key, pe.stage_key) ELSE pe.stage_key END,
    deal_id          = CASE WHEN p_patch ? 'deal_id'
                            THEN NULLIF(p_patch->>'deal_id','')::uuid ELSE pe.deal_id END,
    assigned_to      = CASE WHEN p_patch ? 'assigned_to'
                            THEN NULLIF(p_patch->>'assigned_to','')::uuid ELSE pe.assigned_to END,
    notes            = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE pe.notes END,
    entered_at       = CASE WHEN p_patch ? 'entered_at'
                            THEN NULLIF(p_patch->>'entered_at','')::timestamptz ELSE pe.entered_at END,
    stage_changed_at = CASE WHEN p_patch ? 'stage_changed_at'
                            THEN NULLIF(p_patch->>'stage_changed_at','')::timestamptz ELSE pe.stage_changed_at END,
    -- Merge com strip_nulls no que ENTRA: chave com nulo some, chave ausente
    -- não encosta no que já estava. É o contrato desta família.
    metadata         = CASE WHEN v_meta = '{}'::jsonb
                            THEN pe.metadata
                            ELSE COALESCE(pe.metadata, '{}'::jsonb) || jsonb_strip_nulls(v_meta) END,
    updated_at       = now()
  WHERE pe.id = p_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipelines_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.id             := COALESCE(NEW.id, gen_random_uuid());
  NEW.icon           := COALESCE(NEW.icon, 'kanban');
  NEW.color          := COALESCE(NEW.color, '#3b82f6');
  NEW.position       := COALESCE(NEW.position, 0);
  NEW.is_active      := COALESCE(NEW.is_active, true);
  NEW.lifecycle_type := COALESCE(NEW.lifecycle_type, 'permanent');
  NEW.status         := COALESCE(NEW.status, 'active');
  NEW.created_at     := COALESCE(NEW.created_at, now());
  NEW.updated_at     := COALESCE(NEW.updated_at, now());  -- metric-lint-allow: default de INSTEAD OF INSERT, não métrica (SCRUM-621)

  PERFORM public.custom_pipelines_check_vocab(NEW.lifecycle_type, NEW.status, NEW.template_type);

  INSERT INTO public.pipelines (
    id, organization_id, name, slug, type, description, icon, color,
    display_order, is_active, config, created_by, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.name, NEW.slug, 'custom', NEW.description,
    NEW.icon, NEW.color, NEW.position + 3, NEW.is_active,
    public.custom_pipelines_extras(
      NEW.lifecycle_type, NEW.starts_at, NEW.ends_at, NEW.status,
      NEW.team_goal, NEW.individual_goal, NEW.bonus_value, NEW.bonus_description,
      NEW.objective_pipe_type, NEW.objective_stage_key, NEW.template_type,
      NEW.lead_source_config),
    NEW.created_by, NEW.created_at, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipelines_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.custom_pipelines_check_vocab(NEW.lifecycle_type, NEW.status, NEW.template_type);

  UPDATE public.pipelines p SET
    organization_id = NEW.organization_id,
    name            = NEW.name,
    slug            = NEW.slug,
    description     = NEW.description,
    icon            = NEW.icon,
    color           = NEW.color,
    display_order   = COALESCE(NEW.position, 0) + 3,
    is_active       = NEW.is_active,
    created_by      = NEW.created_by,
    config          = (p.config
                        - 'lifecycle_type' - 'starts_at' - 'ends_at' - 'status'
                        - 'team_goal' - 'individual_goal' - 'bonus_value'
                        - 'bonus_description' - 'objective_pipe_type'
                        - 'objective_stage_key' - 'template_type' - 'lead_source_config')
                      || public.custom_pipelines_extras(
                           NEW.lifecycle_type, NEW.starts_at, NEW.ends_at, NEW.status,
                           NEW.team_goal, NEW.individual_goal, NEW.bonus_value,
                           NEW.bonus_description, NEW.objective_pipe_type,
                           NEW.objective_stage_key, NEW.template_type,
                           NEW.lead_source_config),
    updated_at      = now()
  WHERE p.id = OLD.id AND p.type = 'custom';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pipe public.pipelines%ROWTYPE;
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: pipeline_id é obrigatório';
  END IF;

  SELECT * INTO v_pipe FROM public.pipelines WHERE id = NEW.pipeline_id;
  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não existe em pipelines', NEW.pipeline_id;
  END IF;
  IF v_pipe.type <> 'custom' THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não é custom (type=%)', NEW.pipeline_id, v_pipe.type;
  END IF;

  NEW.id                  := COALESCE(NEW.id, gen_random_uuid());
  NEW.organization_id     := COALESCE(NEW.organization_id, v_pipe.organization_id);
  NEW.color               := COALESCE(NEW.color, '#64748b');
  NEW.position            := COALESCE(NEW.position, 0);
  NEW.is_active           := COALESCE(NEW.is_active, true);
  NEW.is_final_positive   := COALESCE(NEW.is_final_positive, false);
  NEW.is_final_negative   := COALESCE(NEW.is_final_negative, false);
  NEW.stage_role          := COALESCE(NEW.stage_role, 'open');
  NEW.requires_sale_value := COALESCE(NEW.requires_sale_value, false);
  NEW.created_at          := COALESCE(NEW.created_at, now());
  NEW.updated_at          := COALESCE(NEW.updated_at, now());  -- metric-lint-allow: default de INSTEAD OF INSERT, não métrica (SCRUM-616)

  INSERT INTO public.pipeline_stages (
    id, organization_id, pipeline_id, pipeline_type, stage_key, name, color,
    position, is_active, is_final_positive, is_final_negative,
    target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key,
    created_at, updated_at, checklist_template_id,
    stage_role, suggested_stage_role, stage_role_suggested_at,
    stage_role_suggestion_source, stage_role_reviewed_at, stage_role_reviewed_by,
    requires_sale_value
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.pipeline_id, NULL, NEW.stage_key, NEW.name,
    NEW.color, NEW.position, NEW.is_active, NEW.is_final_positive,
    NEW.is_final_negative, NEW.target_pipeline_id, NEW.target_stage_id,
    NEW.target_pipe_type, NEW.target_stage_key, NEW.created_at, NEW.updated_at,
    NEW.checklist_template_id, NEW.stage_role, NEW.suggested_stage_role,
    NEW.stage_role_suggested_at, NEW.stage_role_suggestion_source,
    NEW.stage_role_reviewed_at, NEW.stage_role_reviewed_by,
    NEW.requires_sale_value
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipelines
                    WHERE id = NEW.pipeline_id AND type = 'custom') THEN
      RAISE EXCEPTION 'custom_pipeline_stages: funil % não é custom', NEW.pipeline_id;
    END IF;
  END IF;

  UPDATE public.pipeline_stages SET
    organization_id              = NEW.organization_id,
    pipeline_id                  = NEW.pipeline_id,
    stage_key                    = NEW.stage_key,
    name                         = NEW.name,
    color                        = NEW.color,
    position                     = NEW.position,
    is_active                    = NEW.is_active,
    is_final_positive            = NEW.is_final_positive,
    is_final_negative            = NEW.is_final_negative,
    target_pipeline_id           = NEW.target_pipeline_id,
    target_stage_id              = NEW.target_stage_id,
    target_pipe_type             = NEW.target_pipe_type,
    target_stage_key             = NEW.target_stage_key,
    checklist_template_id        = NEW.checklist_template_id,
    stage_role                   = NEW.stage_role,
    suggested_stage_role         = NEW.suggested_stage_role,
    stage_role_suggested_at      = NEW.stage_role_suggested_at,
    stage_role_suggestion_source = NEW.stage_role_suggestion_source,
    stage_role_reviewed_at       = NEW.stage_role_reviewed_at,
    stage_role_reviewed_by       = NEW.stage_role_reviewed_by,
    requires_sale_value          = NEW.requires_sale_value,
    updated_at                   = now()
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.criar_funil_custom_com_etapas(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.fn_etapa_custom_atualizar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fn_etapa_custom_criar(jsonb);
DROP FUNCTION IF EXISTS public.fn_funil_custom_atualizar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fn_funil_custom_criar(jsonb);

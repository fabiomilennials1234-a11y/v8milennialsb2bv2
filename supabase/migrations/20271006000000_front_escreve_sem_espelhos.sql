-- 20271006000000_front_escreve_sem_espelhos.sql
--
-- SCRUM-673. Funis e etapas custom ganham as mesmas portas compartilhadas que
-- as entradas receberam na SCRUM-674. Os INSTEAD OF viram adaptadores; o front
-- chama as portas diretamente. Nenhuma invariante fica duplicada no cliente.

CREATE OR REPLACE FUNCTION public.sync_lead_fields_to_pipeline_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_patch jsonb;
BEGIN
  IF NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id
     OR NEW.sale_responsible_id IS DISTINCT FROM OLD.sale_responsible_id THEN
    v_patch := '{}'::jsonb;
    IF NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id THEN
      v_patch := v_patch || jsonb_build_object(
        'pre_sale_responsible_id', NEW.pre_sale_responsible_id);
    END IF;
    IF NEW.sale_responsible_id IS DISTINCT FROM OLD.sale_responsible_id THEN
      v_patch := v_patch || jsonb_build_object(
        'sale_responsible_id', NEW.sale_responsible_id);
    END IF;

    PERFORM public.fn_entrada_sistema_atualizar(pe.id, v_patch)
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.lead_id = NEW.id
      AND pe.organization_id = NEW.organization_id
      AND pip.type = 'system' -- metric-lint-allow: projeção operacional, não métrica
      AND pip.slug IN ('whatsapp', 'confirmacao', 'propostas');
  END IF;

  IF NEW.compromisso_date IS DISTINCT FROM OLD.compromisso_date THEN
    PERFORM public.fn_entrada_sistema_atualizar(
      pe.id,
      jsonb_build_object('meeting_date', NEW.compromisso_date))
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    WHERE pe.lead_id = NEW.id
      AND pe.organization_id = NEW.organization_id
      AND pip.type = 'system' -- metric-lint-allow: projeção operacional, não métrica
      AND pip.slug = 'confirmacao';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lead_fields_to_pipeline_entries ON public.leads;
CREATE TRIGGER trg_sync_lead_fields_to_pipeline_entries
  AFTER UPDATE OF pre_sale_responsible_id, sale_responsible_id, compromisso_date
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lead_fields_to_pipeline_entries();

REVOKE ALL ON FUNCTION public.sync_lead_fields_to_pipeline_entries()
  FROM PUBLIC, anon, authenticated;

-- Fecha a família das RPCs de update: um id de custom não pode alterar uma
-- entry de sistema, nem o inverso. RLS separa organizações; esta guarda separa
-- espécies dentro da mesma organização.
CREATE OR REPLACE FUNCTION public.fn_entrada_sistema_atualizar(
  p_entry_id uuid,
  p_patch    jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org  uuid;
  v_type text;
  v_slug text;
  v_meta jsonb;
BEGIN
  SELECT pe.organization_id, pip.type, pip.slug
    INTO v_org, v_type, v_slug
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  WHERE pe.id = p_entry_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_sistema_atualizar: entrada % não existe', p_entry_id;
  END IF;
  IF v_type IS DISTINCT FROM 'system'
     OR v_slug NOT IN ('whatsapp', 'confirmacao', 'propostas') THEN
    RAISE EXCEPTION 'fn_entrada_sistema_atualizar: entrada % não pertence a funil de sistema', p_entry_id;
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
  v_type      text;
  v_stage_id  uuid;
  v_stage_key text;
  v_meta      jsonb;
BEGIN
  SELECT pe.organization_id, pip.type
    INTO v_org, v_type
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  WHERE pe.id = p_entry_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_custom_atualizar: entrada % não existe', p_entry_id;
  END IF;
  IF v_type IS DISTINCT FROM 'custom' THEN
    RAISE EXCEPTION 'fn_entrada_custom_atualizar: entrada % não pertence a funil custom', p_entry_id;
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

CREATE OR REPLACE FUNCTION public.fn_funil_custom_criar(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := COALESCE(NULLIF(p_input->>'id', '')::uuid, gen_random_uuid());
  v_lifecycle text := COALESCE(p_input->>'lifecycle_type', 'permanent');
  v_status text := COALESCE(p_input->>'status', 'active');
BEGIN
  PERFORM public.custom_pipelines_check_vocab(v_lifecycle, v_status, p_input->>'template_type');

  INSERT INTO public.pipelines (
    id, organization_id, name, slug, type, description, icon, color,
    display_order, is_active, config, created_by, created_at, updated_at
  ) VALUES (
    v_id,
    NULLIF(p_input->>'organization_id', '')::uuid,
    p_input->>'name',
    p_input->>'slug',
    'custom',
    p_input->>'description',
    COALESCE(p_input->>'icon', 'kanban'),
    COALESCE(p_input->>'color', '#3b82f6'),
    COALESCE(NULLIF(p_input->>'position', '')::integer, 0) + 3,
    COALESCE((p_input->>'is_active')::boolean, true),
    public.custom_pipelines_extras(
      v_lifecycle,
      NULLIF(p_input->>'starts_at', '')::timestamptz,
      NULLIF(p_input->>'ends_at', '')::timestamptz,
      v_status,
      NULLIF(p_input->>'team_goal', '')::integer,
      NULLIF(p_input->>'individual_goal', '')::integer,
      NULLIF(p_input->>'bonus_value', '')::integer,
      p_input->>'bonus_description',
      p_input->>'objective_pipe_type',
      p_input->>'objective_stage_key',
      p_input->>'template_type',
      p_input->'lead_source_config'),
    NULLIF(p_input->>'created_by', '')::uuid,
    COALESCE(NULLIF(p_input->>'created_at', '')::timestamptz, now()),
    COALESCE(NULLIF(p_input->>'updated_at', '')::timestamptz, now()) -- metric-lint-allow: timestamp operacional do CRUD, não âncora de métrica
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_funil_custom_atualizar(p_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old public.pipelines%ROWTYPE;
  v_lifecycle text;
  v_status text;
  v_template text;
  v_config jsonb;
BEGIN
  SELECT * INTO v_old FROM public.pipelines WHERE id = p_id AND type = 'custom';
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipelines: funil % não é custom', p_id;
  END IF;
  IF p_patch ? '_expected_lifecycle_type'
     AND COALESCE(v_old.config->>'lifecycle_type', 'permanent')
         IS DISTINCT FROM p_patch->>'_expected_lifecycle_type' THEN
    RAISE EXCEPTION 'custom_pipelines: funil % não tem lifecycle_type %',
      p_id, p_patch->>'_expected_lifecycle_type';
  END IF;

  v_lifecycle := CASE WHEN p_patch ? 'lifecycle_type'
    THEN COALESCE(p_patch->>'lifecycle_type', 'permanent')
    ELSE COALESCE(v_old.config->>'lifecycle_type', 'permanent') END;
  v_status := CASE WHEN p_patch ? 'status'
    THEN COALESCE(p_patch->>'status', 'active')
    ELSE COALESCE(v_old.config->>'status', 'active') END;
  v_template := CASE WHEN p_patch ? 'template_type'
    THEN p_patch->>'template_type' ELSE v_old.config->>'template_type' END;

  PERFORM public.custom_pipelines_check_vocab(v_lifecycle, v_status, v_template);

  v_config := (v_old.config
      - 'lifecycle_type' - 'starts_at' - 'ends_at' - 'status'
      - 'team_goal' - 'individual_goal' - 'bonus_value'
      - 'bonus_description' - 'objective_pipe_type'
      - 'objective_stage_key' - 'template_type' - 'lead_source_config')
    || public.custom_pipelines_extras(
      v_lifecycle,
      CASE WHEN p_patch ? 'starts_at' THEN NULLIF(p_patch->>'starts_at', '')::timestamptz
           ELSE NULLIF(v_old.config->>'starts_at', '')::timestamptz END,
      CASE WHEN p_patch ? 'ends_at' THEN NULLIF(p_patch->>'ends_at', '')::timestamptz
           ELSE NULLIF(v_old.config->>'ends_at', '')::timestamptz END,
      v_status,
      CASE WHEN p_patch ? 'team_goal' THEN NULLIF(p_patch->>'team_goal', '')::integer
           ELSE NULLIF(v_old.config->>'team_goal', '')::integer END,
      CASE WHEN p_patch ? 'individual_goal' THEN NULLIF(p_patch->>'individual_goal', '')::integer
           ELSE NULLIF(v_old.config->>'individual_goal', '')::integer END,
      CASE WHEN p_patch ? 'bonus_value' THEN NULLIF(p_patch->>'bonus_value', '')::integer
           ELSE NULLIF(v_old.config->>'bonus_value', '')::integer END,
      CASE WHEN p_patch ? 'bonus_description' THEN p_patch->>'bonus_description'
           ELSE v_old.config->>'bonus_description' END,
      CASE WHEN p_patch ? 'objective_pipe_type' THEN p_patch->>'objective_pipe_type'
           ELSE v_old.config->>'objective_pipe_type' END,
      CASE WHEN p_patch ? 'objective_stage_key' THEN p_patch->>'objective_stage_key'
           ELSE v_old.config->>'objective_stage_key' END,
      v_template,
      CASE WHEN p_patch ? 'lead_source_config' THEN p_patch->'lead_source_config'
           ELSE v_old.config->'lead_source_config' END);

  UPDATE public.pipelines SET
    organization_id = CASE WHEN p_patch ? 'organization_id'
      THEN NULLIF(p_patch->>'organization_id', '')::uuid ELSE v_old.organization_id END,
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE v_old.name END,
    slug = CASE WHEN p_patch ? 'slug' THEN p_patch->>'slug' ELSE v_old.slug END,
    description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE v_old.description END,
    icon = CASE WHEN p_patch ? 'icon' THEN p_patch->>'icon' ELSE v_old.icon END,
    color = CASE WHEN p_patch ? 'color' THEN p_patch->>'color' ELSE v_old.color END,
    display_order = CASE WHEN p_patch ? 'position'
      THEN COALESCE(NULLIF(p_patch->>'position', '')::integer, 0) + 3 ELSE v_old.display_order END,
    is_active = CASE WHEN p_patch ? 'is_active'
      THEN (p_patch->>'is_active')::boolean ELSE v_old.is_active END,
    created_by = CASE WHEN p_patch ? 'created_by'
      THEN NULLIF(p_patch->>'created_by', '')::uuid ELSE v_old.created_by END,
    config = v_config,
    updated_at = now()
  WHERE id = p_id AND type = 'custom';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_etapa_custom_criar(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pipe public.pipelines%ROWTYPE;
  v_id uuid := COALESCE(NULLIF(p_input->>'id', '')::uuid, gen_random_uuid());
  v_pipeline_id uuid := NULLIF(p_input->>'pipeline_id', '')::uuid;
BEGIN
  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: pipeline_id é obrigatório';
  END IF;

  SELECT * INTO v_pipe FROM public.pipelines WHERE id = v_pipeline_id;
  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não existe em pipelines', v_pipeline_id;
  END IF;
  IF v_pipe.type <> 'custom' THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não é custom (type=%)', v_pipeline_id, v_pipe.type;
  END IF;

  INSERT INTO public.pipeline_stages (
    id, organization_id, pipeline_id, pipeline_type, stage_key, name, color,
    position, is_active, is_final_positive, is_final_negative,
    target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key,
    created_at, updated_at, checklist_template_id,
    stage_role, suggested_stage_role, stage_role_suggested_at,
    stage_role_suggestion_source, stage_role_reviewed_at, stage_role_reviewed_by,
    requires_sale_value
  ) VALUES (
    v_id,
    COALESCE(NULLIF(p_input->>'organization_id', '')::uuid, v_pipe.organization_id),
    v_pipeline_id,
    NULL,
    p_input->>'stage_key',
    p_input->>'name',
    COALESCE(p_input->>'color', '#64748b'),
    COALESCE(NULLIF(p_input->>'position', '')::integer, 0),
    COALESCE((p_input->>'is_active')::boolean, true),
    COALESCE((p_input->>'is_final_positive')::boolean, false),
    COALESCE((p_input->>'is_final_negative')::boolean, false),
    NULLIF(p_input->>'target_pipeline_id', '')::uuid,
    NULLIF(p_input->>'target_stage_id', '')::uuid,
    p_input->>'target_pipe_type',
    p_input->>'target_stage_key',
    COALESCE(NULLIF(p_input->>'created_at', '')::timestamptz, now()),
    COALESCE(NULLIF(p_input->>'updated_at', '')::timestamptz, now()), -- metric-lint-allow: timestamp operacional do CRUD, não âncora de métrica
    NULLIF(p_input->>'checklist_template_id', '')::uuid,
    COALESCE(NULLIF(p_input->>'stage_role', '')::public.stage_role, 'open'::public.stage_role),
    NULLIF(p_input->>'suggested_stage_role', '')::public.stage_role,
    NULLIF(p_input->>'stage_role_suggested_at', '')::timestamptz,
    p_input->>'stage_role_suggestion_source',
    NULLIF(p_input->>'stage_role_reviewed_at', '')::timestamptz,
    NULLIF(p_input->>'stage_role_reviewed_by', '')::uuid,
    COALESCE((p_input->>'requires_sale_value')::boolean, false)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_etapa_custom_atualizar(p_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old public.pipeline_stages%ROWTYPE;
  v_pipeline_id uuid;
BEGIN
  SELECT * INTO v_old FROM public.pipeline_stages WHERE id = p_id;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: etapa % não existe', p_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines
    WHERE id = v_old.pipeline_id AND type = 'custom'
  ) THEN
    RAISE EXCEPTION 'custom_pipeline_stages: etapa % não pertence a funil custom', p_id;
  END IF;

  v_pipeline_id := CASE WHEN p_patch ? 'pipeline_id'
    THEN NULLIF(p_patch->>'pipeline_id', '')::uuid ELSE v_old.pipeline_id END;
  IF v_pipeline_id IS DISTINCT FROM v_old.pipeline_id
     AND NOT EXISTS (SELECT 1 FROM public.pipelines WHERE id = v_pipeline_id AND type = 'custom') THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não é custom', v_pipeline_id;
  END IF;

  UPDATE public.pipeline_stages SET
    organization_id = CASE WHEN p_patch ? 'organization_id' THEN NULLIF(p_patch->>'organization_id', '')::uuid ELSE v_old.organization_id END,
    pipeline_id = v_pipeline_id,
    stage_key = CASE WHEN p_patch ? 'stage_key' THEN p_patch->>'stage_key' ELSE v_old.stage_key END,
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE v_old.name END,
    color = CASE WHEN p_patch ? 'color' THEN p_patch->>'color' ELSE v_old.color END,
    position = CASE WHEN p_patch ? 'position' THEN NULLIF(p_patch->>'position', '')::integer ELSE v_old.position END,
    is_active = CASE WHEN p_patch ? 'is_active' THEN (p_patch->>'is_active')::boolean ELSE v_old.is_active END,
    is_final_positive = CASE WHEN p_patch ? 'is_final_positive' THEN (p_patch->>'is_final_positive')::boolean ELSE v_old.is_final_positive END,
    is_final_negative = CASE WHEN p_patch ? 'is_final_negative' THEN (p_patch->>'is_final_negative')::boolean ELSE v_old.is_final_negative END,
    target_pipeline_id = CASE WHEN p_patch ? 'target_pipeline_id' THEN NULLIF(p_patch->>'target_pipeline_id', '')::uuid ELSE v_old.target_pipeline_id END,
    target_stage_id = CASE WHEN p_patch ? 'target_stage_id' THEN NULLIF(p_patch->>'target_stage_id', '')::uuid ELSE v_old.target_stage_id END,
    target_pipe_type = CASE WHEN p_patch ? 'target_pipe_type' THEN p_patch->>'target_pipe_type' ELSE v_old.target_pipe_type END,
    target_stage_key = CASE WHEN p_patch ? 'target_stage_key' THEN p_patch->>'target_stage_key' ELSE v_old.target_stage_key END,
    checklist_template_id = CASE WHEN p_patch ? 'checklist_template_id' THEN NULLIF(p_patch->>'checklist_template_id', '')::uuid ELSE v_old.checklist_template_id END,
    stage_role = CASE WHEN p_patch ? 'stage_role' THEN NULLIF(p_patch->>'stage_role', '')::public.stage_role ELSE v_old.stage_role END,
    suggested_stage_role = CASE WHEN p_patch ? 'suggested_stage_role' THEN NULLIF(p_patch->>'suggested_stage_role', '')::public.stage_role ELSE v_old.suggested_stage_role END,
    stage_role_suggested_at = CASE WHEN p_patch ? 'stage_role_suggested_at' THEN NULLIF(p_patch->>'stage_role_suggested_at', '')::timestamptz ELSE v_old.stage_role_suggested_at END,
    stage_role_suggestion_source = CASE WHEN p_patch ? 'stage_role_suggestion_source' THEN p_patch->>'stage_role_suggestion_source' ELSE v_old.stage_role_suggestion_source END,
    stage_role_reviewed_at = CASE WHEN p_patch ? 'stage_role_reviewed_at' THEN NULLIF(p_patch->>'stage_role_reviewed_at', '')::timestamptz ELSE v_old.stage_role_reviewed_at END,
    stage_role_reviewed_by = CASE WHEN p_patch ? 'stage_role_reviewed_by' THEN NULLIF(p_patch->>'stage_role_reviewed_by', '')::uuid ELSE v_old.stage_role_reviewed_by END,
    requires_sale_value = CASE WHEN p_patch ? 'requires_sale_value' THEN (p_patch->>'requires_sale_value')::boolean ELSE v_old.requires_sale_value END,
    updated_at = now()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_funil_custom_com_etapas(p_funil jsonb, p_etapas jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage jsonb;
BEGIN
  IF jsonb_typeof(p_etapas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'criar_funil_custom_com_etapas: p_etapas deve ser array';
  END IF;

  v_pipeline_id := public.fn_funil_custom_criar(p_funil);
  FOR v_stage IN SELECT value FROM jsonb_array_elements(p_etapas)
  LOOP
    PERFORM public.fn_etapa_custom_criar(
      v_stage || jsonb_build_object('pipeline_id', v_pipeline_id));
  END LOOP;
  RETURN v_pipeline_id;
END;
$$;

-- Os quatro INSTEAD OF passam a ser adaptadores finos das portas acima.
CREATE OR REPLACE FUNCTION public.custom_pipelines_insert_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  NEW.id := public.fn_funil_custom_criar(to_jsonb(NEW));
  SELECT cp.* INTO NEW FROM public.custom_pipelines cp WHERE cp.id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipelines_update_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  PERFORM public.fn_funil_custom_atualizar(OLD.id, to_jsonb(NEW));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_insert_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  NEW.id := public.fn_etapa_custom_criar(to_jsonb(NEW));
  SELECT cps.* INTO NEW FROM public.custom_pipeline_stages cps WHERE cps.id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_update_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  PERFORM public.fn_etapa_custom_atualizar(OLD.id, to_jsonb(NEW));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_funil_custom_criar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_funil_custom_atualizar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_etapa_custom_criar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_etapa_custom_atualizar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.criar_funil_custom_com_etapas(jsonb, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_funil_custom_criar(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_funil_custom_atualizar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_etapa_custom_criar(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_etapa_custom_atualizar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_funil_custom_com_etapas(jsonb, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.criar_funil_custom_com_etapas(jsonb, jsonb) IS
  'SCRUM-673: cria funil custom e etapas atomicamente sem escrever pelos espelhos.';

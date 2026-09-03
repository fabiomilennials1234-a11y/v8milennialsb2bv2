-- 20270920000000_demolicao_dos_espelhos.sql — ROLLBACK
--
-- Recria os 6 espelhos EXATAMENTE como estavam em PROD em 2026-09-03,
-- capturados de `pg_get_viewdef` / `pg_get_functiondef` / `pg_get_triggerdef`
-- do projeto jsjsmuncfkbsbzqzqhfq. Não é reconstrução de memória nem cópia da
-- migration que os criou: é o corpo VIVO do dia da captura — que é o que
-- importa, porque o repo já provou estar atrás do prod (7 migrations no ledger
-- sem arquivo nesta worktree).
--
-- Ordem: funções de trigger → views → grants → triggers INSTEAD OF → comments.
-- (Trigger depende da view E da função; a função não depende da view.)
--
-- NÃO recria os wrappers de RPC legados nem os grants deles — esses ficam
-- num bloco separado no fim, também capturados de prod.

BEGIN;


-- ═══ 1. Funções INSTEAD OF ═══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_pipe_entries_delete_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipe_entries_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pipe  public.pipelines%ROWTYPE;
  v_stage public.pipeline_stages%ROWTYPE;
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: pipeline_id é obrigatório';
  END IF;
  SELECT * INTO v_pipe FROM public.pipelines WHERE id = NEW.pipeline_id;
  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: funil % não existe em pipelines', NEW.pipeline_id;
  END IF;
  IF v_pipe.type <> 'custom' THEN
    RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom (type=%)', NEW.pipeline_id, v_pipe.type;
  END IF;
  -- Contrato da tabela antiga: lead e etapa NOT NULL.
  IF NEW.lead_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: lead_id é obrigatório' USING ERRCODE = 'not_null_violation';
  END IF;
  IF NEW.stage_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: stage_id é obrigatório' USING ERRCODE = 'not_null_violation';
  END IF;
  SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF v_stage.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: etapa % não existe', NEW.stage_id;
  END IF;
  IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
    RAISE EXCEPTION 'custom_pipe_entries: etapa % pertence ao funil %, não ao funil % do card',
      NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
  END IF;

  NEW.id               := COALESCE(NEW.id, gen_random_uuid());
  NEW.organization_id  := COALESCE(NEW.organization_id, v_pipe.organization_id);
  NEW.entered_at       := COALESCE(NEW.entered_at, now());
  NEW.stage_changed_at := COALESCE(NEW.stage_changed_at, now());
  NEW.created_at       := COALESCE(NEW.created_at, now());
  NEW.updated_at       := COALESCE(NEW.updated_at, now());  -- metric-lint-allow: default de INSTEAD OF INSERT, não métrica (SCRUM-621)

  -- Tenancy dos responsáveis em metadata (o da tabela morreu com ela;
  -- assigned_to segue coberto por trg_assert_member_same_org_pipeline_entries).
  PERFORM public.fn_assert_member_in_org(NEW.pre_sale_responsible_id, NEW.organization_id, 'pre_sale_responsible_id');
  PERFORM public.fn_assert_member_in_org(NEW.sale_responsible_id,     NEW.organization_id, 'sale_responsible_id');

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id,
    assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.pipeline_id, NEW.lead_id, NEW.deal_id,
    v_stage.stage_key, NEW.stage_id, NEW.assigned_to, NEW.notes,
    '{}'::jsonb || jsonb_strip_nulls(jsonb_build_object(
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id',     NEW.sale_responsible_id)),
    NEW.entered_at, NEW.stage_changed_at, NEW.created_at, NEW.updated_at
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipe_entries_update_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stage_key text;
BEGIN
  IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipelines
                    WHERE id = NEW.pipeline_id AND type = 'custom') THEN
      RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom', NEW.pipeline_id;
    END IF;
  END IF;

  -- stage_key entra no SET pra manter os AFTER ... OF stage_key da base
  -- elegíveis (dispatch/workflow/checklist/história). O BEFORE-mirror
  -- (pipeline_entries_stage_mirror) revalida e é o dono final do espelho.
  SELECT ps.stage_key INTO v_stage_key
  FROM public.pipeline_stages ps WHERE ps.id = NEW.stage_id;

  IF NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id THEN
    PERFORM public.fn_assert_member_in_org(NEW.pre_sale_responsible_id, NEW.organization_id, 'pre_sale_responsible_id');
  END IF;
  IF NEW.sale_responsible_id IS DISTINCT FROM OLD.sale_responsible_id THEN
    PERFORM public.fn_assert_member_in_org(NEW.sale_responsible_id, NEW.organization_id, 'sale_responsible_id');
  END IF;

  UPDATE public.pipeline_entries pe SET
    organization_id  = NEW.organization_id,
    pipeline_id      = NEW.pipeline_id,
    lead_id          = NEW.lead_id,
    stage_id         = NEW.stage_id,
    stage_key        = COALESCE(v_stage_key, pe.stage_key),
    assigned_to      = NEW.assigned_to,
    notes            = NEW.notes,
    entered_at       = NEW.entered_at,
    stage_changed_at = NEW.stage_changed_at,
    deal_id          = NEW.deal_id,
    metadata         = (pe.metadata - 'pre_sale_responsible_id' - 'sale_responsible_id')
                       || jsonb_strip_nulls(jsonb_build_object(
                            'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
                            'sale_responsible_id',     NEW.sale_responsible_id)),
    updated_at       = now()
  WHERE pe.id = OLD.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_delete_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM public.pipeline_stages WHERE id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_update_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipelines_delete_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM public.pipelines WHERE id = OLD.id AND type = 'custom';
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipelines_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.custom_pipelines_update_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_delete_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND slug = 'confirmacao' AND type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline confirmacao not found for org %', NEW.organization_id;
  END IF;

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.lead_id,
    NEW.organization_id,
    v_pipeline_id,
    COALESCE(NEW.status, 'marcada'),
    COALESCE(NEW.responsible_id, NEW.closer_id, NEW.sdr_id),
    jsonb_build_object(
      'meeting_date',     NEW.meeting_date,
      'is_confirmed',     COALESCE(NEW.is_confirmed, false),
      'closer_id',        NEW.closer_id,
      'responsible_id',   NEW.responsible_id,
      'sdr_id',           NEW.sdr_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'meet_link',        NEW.meet_link,
      'metrics_period_at', NEW.metrics_period_at
    ),
    NEW.notes
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_update_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE public.pipeline_entries SET
    stage_key   = NEW.status,
    assigned_to = COALESCE(NEW.responsible_id, NEW.closer_id, NEW.sdr_id),
    metadata    = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'meeting_date',     NEW.meeting_date,
                       'is_confirmed',     NEW.is_confirmed,
                       'closer_id',        NEW.closer_id,
                       'responsible_id',   NEW.responsible_id,
                       'sdr_id',           NEW.sdr_id,
                       'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
                       'sale_responsible_id', NEW.sale_responsible_id,
                       'meet_link',        NEW.meet_link,
                       'metrics_period_at', NEW.metrics_period_at
                     ),
    notes       = NEW.notes,
    updated_at  = now()
  WHERE id = OLD.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_propostas_delete_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_propostas_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND slug = 'propostas' AND type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline propostas not found for org %', NEW.organization_id;
  END IF;

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes, closed_at)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.lead_id,
    NEW.organization_id,
    v_pipeline_id,
    COALESCE(NEW.status, 'enviada'),
    COALESCE(NEW.responsible_id, NEW.closer_id),
    jsonb_build_object(
      'sale_value',       NEW.sale_value,
      'closer_id',        NEW.closer_id,
      'responsible_id',   NEW.responsible_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'product_id',       NEW.product_id,
      'product_type',     NEW.product_type,
      'calor',            NEW.calor,
      'loss_reason',      NEW.loss_reason,
      'loss_reason_id',   NEW.loss_reason_id,
      'commitment_date',  NEW.commitment_date,
      'contract_duration', NEW.contract_duration,
      'metrics_period_at', NEW.metrics_period_at
    ),
    NEW.notes,
    NEW.closed_at
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_propostas_update_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE public.pipeline_entries SET
    stage_key   = NEW.status,
    assigned_to = COALESCE(NEW.responsible_id, NEW.closer_id),
    metadata    = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'sale_value',       NEW.sale_value,
                       'closer_id',        NEW.closer_id,
                       'responsible_id',   NEW.responsible_id,
                       'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
                       'sale_responsible_id', NEW.sale_responsible_id,
                       'product_id',       NEW.product_id,
                       'product_type',     NEW.product_type,
                       'calor',            NEW.calor,
                       'loss_reason',      NEW.loss_reason,
                       'loss_reason_id',   NEW.loss_reason_id,
                       'commitment_date',  NEW.commitment_date,
                       'contract_duration', NEW.contract_duration,
                       'metrics_period_at', NEW.metrics_period_at
                     ),
    notes       = NEW.notes,
    closed_at   = NEW.closed_at,
    updated_at  = now()
  WHERE id = OLD.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_delete_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND slug = 'whatsapp' AND type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline whatsapp not found for org %', NEW.organization_id;
  END IF;

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.lead_id,
    NEW.organization_id,
    v_pipeline_id,
    COALESCE(NEW.status, 'novo_lead'),
    COALESCE(NEW.responsible_id, NEW.sdr_id),
    jsonb_build_object(
      'responsible_id', NEW.responsible_id,
      'sdr_id',         NEW.sdr_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'scheduled_date', NEW.scheduled_date
    ),
    NEW.notes
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_update_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE public.pipeline_entries SET
    stage_key   = NEW.status,
    assigned_to = COALESCE(NEW.responsible_id, NEW.sdr_id),
    metadata    = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'responsible_id', NEW.responsible_id,
                       'sdr_id',         NEW.sdr_id,
                       'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
                       'sale_responsible_id', NEW.sale_responsible_id,
                       'scheduled_date', NEW.scheduled_date
                     ),
    notes       = NEW.notes,
    updated_at  = now()
  WHERE id = OLD.id;
  RETURN NEW;
END;
$function$;


-- ═══ 2. Views de compat ══════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.custom_pipe_entries AS  SELECT pe.id,
    pe.organization_id,
    pe.pipeline_id,
    pe.lead_id,
    pe.stage_id,
    pe.assigned_to,
    pe.notes,
    pe.entered_at,
    pe.stage_changed_at,
    pe.created_at,
    pe.updated_at,
    (pe.metadata ->> 'pre_sale_responsible_id'::text)::uuid AS pre_sale_responsible_id,
    (pe.metadata ->> 'sale_responsible_id'::text)::uuid AS sale_responsible_id,
    pe.deal_id
   FROM pipeline_entries pe
     JOIN pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'::text;

CREATE OR REPLACE VIEW public.custom_pipeline_stages AS  SELECT ps.id,
    ps.organization_id,
    ps.pipeline_id,
    ps.stage_key,
    ps.name,
    ps.color,
    ps."position",
    ps.is_active,
    ps.is_final_positive,
    ps.is_final_negative,
    ps.target_pipeline_id,
    ps.target_stage_id,
    ps.target_pipe_type,
    ps.target_stage_key,
    ps.created_at,
    ps.updated_at,
    ps.checklist_template_id,
    ps.stage_role,
    ps.suggested_stage_role,
    ps.stage_role_suggested_at,
    ps.stage_role_suggestion_source,
    ps.stage_role_reviewed_at,
    ps.stage_role_reviewed_by,
    ps.requires_sale_value
   FROM pipeline_stages ps
     JOIN pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'::text;

CREATE OR REPLACE VIEW public.custom_pipelines AS  SELECT id,
    organization_id,
    name,
    slug,
    description,
    icon,
    color,
    display_order - 3 AS "position",
    is_active,
    created_by,
    created_at,
    updated_at,
    COALESCE(config ->> 'lifecycle_type'::text, 'permanent'::text) AS lifecycle_type,
    (config ->> 'starts_at'::text)::timestamp with time zone AS starts_at,
    (config ->> 'ends_at'::text)::timestamp with time zone AS ends_at,
    COALESCE(config ->> 'status'::text, 'active'::text) AS status,
    (config ->> 'team_goal'::text)::integer AS team_goal,
    (config ->> 'individual_goal'::text)::integer AS individual_goal,
    (config ->> 'bonus_value'::text)::integer AS bonus_value,
    config ->> 'bonus_description'::text AS bonus_description,
    config ->> 'objective_pipe_type'::text AS objective_pipe_type,
    config ->> 'objective_stage_key'::text AS objective_stage_key,
    config ->> 'template_type'::text AS template_type,
    config -> 'lead_source_config'::text AS lead_source_config
   FROM pipelines p
  WHERE type = 'custom'::text;

CREATE OR REPLACE VIEW public.pipe_confirmacao AS  SELECT pe.id,
    pe.lead_id,
    pe.organization_id,
    pe.stage_key AS status,
    (pe.metadata ->> 'meeting_date'::text)::timestamp with time zone AS meeting_date,
    COALESCE((pe.metadata ->> 'is_confirmed'::text)::boolean, false) AS is_confirmed,
    (pe.metadata ->> 'closer_id'::text)::uuid AS closer_id,
    (pe.metadata ->> 'responsible_id'::text)::uuid AS responsible_id,
    (pe.metadata ->> 'sdr_id'::text)::uuid AS sdr_id,
    (pe.metadata ->> 'pre_sale_responsible_id'::text)::uuid AS pre_sale_responsible_id,
    (pe.metadata ->> 'sale_responsible_id'::text)::uuid AS sale_responsible_id,
    pe.metadata ->> 'meet_link'::text AS meet_link,
    pe.notes,
    (pe.metadata ->> 'metrics_period_at'::text)::timestamp with time zone AS metrics_period_at,
    pe.created_at,
    pe.updated_at
   FROM pipeline_entries pe
     JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao'::text AND pip.type = 'system'::text;

CREATE OR REPLACE VIEW public.pipe_propostas AS  SELECT pe.id,
    pe.lead_id,
    pe.organization_id,
    pe.stage_key AS status,
    (pe.metadata ->> 'sale_value'::text)::numeric AS sale_value,
    (pe.metadata ->> 'closer_id'::text)::uuid AS closer_id,
    (pe.metadata ->> 'responsible_id'::text)::uuid AS responsible_id,
    (pe.metadata ->> 'pre_sale_responsible_id'::text)::uuid AS pre_sale_responsible_id,
    (pe.metadata ->> 'sale_responsible_id'::text)::uuid AS sale_responsible_id,
    (pe.metadata ->> 'product_id'::text)::uuid AS product_id,
    pe.metadata ->> 'product_type'::text AS product_type,
    (pe.metadata ->> 'calor'::text)::integer AS calor,
    pe.metadata ->> 'loss_reason'::text AS loss_reason,
    (pe.metadata ->> 'loss_reason_id'::text)::uuid AS loss_reason_id,
    (pe.metadata ->> 'commitment_date'::text)::date AS commitment_date,
    (pe.metadata ->> 'contract_duration'::text)::integer AS contract_duration,
    pe.notes,
    (pe.metadata ->> 'metrics_period_at'::text)::timestamp with time zone AS metrics_period_at,
    pe.closed_at,
    pe.created_at,
    pe.updated_at
   FROM pipeline_entries pe
     JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas'::text AND pip.type = 'system'::text;

CREATE OR REPLACE VIEW public.pipe_whatsapp AS  SELECT pe.id,
    pe.lead_id,
    pe.organization_id,
    pe.stage_key AS status,
    (pe.metadata ->> 'responsible_id'::text)::uuid AS responsible_id,
    (pe.metadata ->> 'sdr_id'::text)::uuid AS sdr_id,
    (pe.metadata ->> 'pre_sale_responsible_id'::text)::uuid AS pre_sale_responsible_id,
    (pe.metadata ->> 'sale_responsible_id'::text)::uuid AS sale_responsible_id,
    (pe.metadata ->> 'scheduled_date'::text)::timestamp with time zone AS scheduled_date,
    pe.notes,
    pe.created_at,
    pe.updated_at
   FROM pipeline_entries pe
     JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'whatsapp'::text AND pip.type = 'system'::text;


-- ═══ 3. Grants ═══════════════════════════════════════════════════════════

GRANT SELECT, TRIGGER, REFERENCES ON public.custom_pipe_entries TO anon;

GRANT INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT ON public.custom_pipe_entries TO authenticated;

GRANT SELECT ON public.custom_pipe_entries TO mcp_readonly;

GRANT TRIGGER, UPDATE, DELETE, SELECT, INSERT, REFERENCES, TRUNCATE ON public.custom_pipe_entries TO postgres;

GRANT TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT ON public.custom_pipe_entries TO service_role;

GRANT REFERENCES, TRIGGER, SELECT ON public.custom_pipeline_stages TO anon;

GRANT TRUNCATE, DELETE, UPDATE, SELECT, INSERT, TRIGGER, REFERENCES ON public.custom_pipeline_stages TO authenticated;

GRANT SELECT ON public.custom_pipeline_stages TO mcp_readonly;

GRANT DELETE, UPDATE, TRUNCATE, TRIGGER, REFERENCES, INSERT, SELECT ON public.custom_pipeline_stages TO postgres;

GRANT SELECT, DELETE, UPDATE, INSERT, TRIGGER, REFERENCES, TRUNCATE ON public.custom_pipeline_stages TO service_role;

GRANT REFERENCES, SELECT, TRIGGER ON public.custom_pipelines TO anon;

GRANT SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER, UPDATE ON public.custom_pipelines TO authenticated;

GRANT SELECT ON public.custom_pipelines TO mcp_readonly;

GRANT TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.custom_pipelines TO postgres;

GRANT TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.custom_pipelines TO service_role;

GRANT INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT ON public.pipe_confirmacao TO authenticated;

GRANT SELECT ON public.pipe_confirmacao TO mcp_readonly;

GRANT TRIGGER, INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRUNCATE ON public.pipe_confirmacao TO postgres;

GRANT UPDATE, SELECT, INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE ON public.pipe_confirmacao TO service_role;

GRANT TRUNCATE, DELETE, SELECT, INSERT, REFERENCES, TRIGGER, UPDATE ON public.pipe_propostas TO authenticated;

GRANT SELECT ON public.pipe_propostas TO mcp_readonly;

GRANT DELETE, INSERT, SELECT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.pipe_propostas TO postgres;

GRANT REFERENCES, INSERT, TRIGGER, SELECT, UPDATE, DELETE, TRUNCATE ON public.pipe_propostas TO service_role;

GRANT INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT ON public.pipe_whatsapp TO authenticated;

GRANT SELECT ON public.pipe_whatsapp TO mcp_readonly;

GRANT TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT ON public.pipe_whatsapp TO postgres;

GRANT REFERENCES, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.pipe_whatsapp TO service_role;


-- ═══ 4. Triggers INSTEAD OF ══════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_custom_pipe_entries_delete ON public.custom_pipe_entries;
CREATE TRIGGER trg_custom_pipe_entries_delete INSTEAD OF DELETE ON public.custom_pipe_entries FOR EACH ROW EXECUTE FUNCTION custom_pipe_entries_delete_fn();

DROP TRIGGER IF EXISTS trg_custom_pipe_entries_insert ON public.custom_pipe_entries;
CREATE TRIGGER trg_custom_pipe_entries_insert INSTEAD OF INSERT ON public.custom_pipe_entries FOR EACH ROW EXECUTE FUNCTION custom_pipe_entries_insert_fn();

DROP TRIGGER IF EXISTS trg_custom_pipe_entries_update ON public.custom_pipe_entries;
CREATE TRIGGER trg_custom_pipe_entries_update INSTEAD OF UPDATE ON public.custom_pipe_entries FOR EACH ROW EXECUTE FUNCTION custom_pipe_entries_update_fn();

DROP TRIGGER IF EXISTS trg_custom_pipeline_stages_delete ON public.custom_pipeline_stages;
CREATE TRIGGER trg_custom_pipeline_stages_delete INSTEAD OF DELETE ON public.custom_pipeline_stages FOR EACH ROW EXECUTE FUNCTION custom_pipeline_stages_delete_fn();

DROP TRIGGER IF EXISTS trg_custom_pipeline_stages_insert ON public.custom_pipeline_stages;
CREATE TRIGGER trg_custom_pipeline_stages_insert INSTEAD OF INSERT ON public.custom_pipeline_stages FOR EACH ROW EXECUTE FUNCTION custom_pipeline_stages_insert_fn();

DROP TRIGGER IF EXISTS trg_custom_pipeline_stages_update ON public.custom_pipeline_stages;
CREATE TRIGGER trg_custom_pipeline_stages_update INSTEAD OF UPDATE ON public.custom_pipeline_stages FOR EACH ROW EXECUTE FUNCTION custom_pipeline_stages_update_fn();

DROP TRIGGER IF EXISTS trg_custom_pipelines_delete ON public.custom_pipelines;
CREATE TRIGGER trg_custom_pipelines_delete INSTEAD OF DELETE ON public.custom_pipelines FOR EACH ROW EXECUTE FUNCTION custom_pipelines_delete_fn();

DROP TRIGGER IF EXISTS trg_custom_pipelines_insert ON public.custom_pipelines;
CREATE TRIGGER trg_custom_pipelines_insert INSTEAD OF INSERT ON public.custom_pipelines FOR EACH ROW EXECUTE FUNCTION custom_pipelines_insert_fn();

DROP TRIGGER IF EXISTS trg_custom_pipelines_update ON public.custom_pipelines;
CREATE TRIGGER trg_custom_pipelines_update INSTEAD OF UPDATE ON public.custom_pipelines FOR EACH ROW EXECUTE FUNCTION custom_pipelines_update_fn();

DROP TRIGGER IF EXISTS trg_pipe_confirmacao_delete ON public.pipe_confirmacao;
CREATE TRIGGER trg_pipe_confirmacao_delete INSTEAD OF DELETE ON public.pipe_confirmacao FOR EACH ROW EXECUTE FUNCTION pipe_confirmacao_delete_fn();

DROP TRIGGER IF EXISTS trg_pipe_confirmacao_insert ON public.pipe_confirmacao;
CREATE TRIGGER trg_pipe_confirmacao_insert INSTEAD OF INSERT ON public.pipe_confirmacao FOR EACH ROW EXECUTE FUNCTION pipe_confirmacao_insert_fn();

DROP TRIGGER IF EXISTS trg_pipe_confirmacao_update ON public.pipe_confirmacao;
CREATE TRIGGER trg_pipe_confirmacao_update INSTEAD OF UPDATE ON public.pipe_confirmacao FOR EACH ROW EXECUTE FUNCTION pipe_confirmacao_update_fn();

DROP TRIGGER IF EXISTS trg_pipe_propostas_delete ON public.pipe_propostas;
CREATE TRIGGER trg_pipe_propostas_delete INSTEAD OF DELETE ON public.pipe_propostas FOR EACH ROW EXECUTE FUNCTION pipe_propostas_delete_fn();

DROP TRIGGER IF EXISTS trg_pipe_propostas_insert ON public.pipe_propostas;
CREATE TRIGGER trg_pipe_propostas_insert INSTEAD OF INSERT ON public.pipe_propostas FOR EACH ROW EXECUTE FUNCTION pipe_propostas_insert_fn();

DROP TRIGGER IF EXISTS trg_pipe_propostas_update ON public.pipe_propostas;
CREATE TRIGGER trg_pipe_propostas_update INSTEAD OF UPDATE ON public.pipe_propostas FOR EACH ROW EXECUTE FUNCTION pipe_propostas_update_fn();

DROP TRIGGER IF EXISTS trg_pipe_whatsapp_delete ON public.pipe_whatsapp;
CREATE TRIGGER trg_pipe_whatsapp_delete INSTEAD OF DELETE ON public.pipe_whatsapp FOR EACH ROW EXECUTE FUNCTION pipe_whatsapp_delete_fn();

DROP TRIGGER IF EXISTS trg_pipe_whatsapp_insert ON public.pipe_whatsapp;
CREATE TRIGGER trg_pipe_whatsapp_insert INSTEAD OF INSERT ON public.pipe_whatsapp FOR EACH ROW EXECUTE FUNCTION pipe_whatsapp_insert_fn();

DROP TRIGGER IF EXISTS trg_pipe_whatsapp_update ON public.pipe_whatsapp;
CREATE TRIGGER trg_pipe_whatsapp_update INSTEAD OF UPDATE ON public.pipe_whatsapp FOR EACH ROW EXECUTE FUNCTION pipe_whatsapp_update_fn();


-- ═══ 5. Comments ═════════════════════════════════════════════════════════

COMMENT ON VIEW public.custom_pipe_entries IS 'View de compat sobre pipeline_entries (funis type=custom). D5: espelho com data pra morrer — cai na F6. pre_sale/sale_responsible_id vivem em pipeline_entries.metadata (mesmo padrão das views pipe_*). SCRUM-621.';

COMMENT ON VIEW public.custom_pipeline_stages IS 'View de compat sobre pipeline_stages (funis type=custom). D5: espelho com data pra morrer — cai na F6 da unificação de funis. SCRUM-616.';

COMMENT ON VIEW public.custom_pipelines IS 'View de compat sobre pipelines (type=custom). D5: espelho com data pra morrer — cai na F6 da unificação de funis. Extras vivem em pipelines.config; position = display_order - 3. SCRUM-621.';


COMMIT;

-- ═══ 6. Wrappers de RPC legados (corpos exatos de prod, 2026-09-03) ══════

-- Recriados só para desfazer a demolição por inteiro. Se o rollback for
-- permanente, estes voltam a ser dívida: nenhum tinha chamador medido.

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_add_to_custom_pipe(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre bulk_add_to_pipeline.
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = p_pipeline_id AND type = 'custom') THEN
    RETURN;
  END IF;
  PERFORM public.bulk_add_to_pipeline(p_lead_ids, p_pipeline_id, p_stage_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bulk_add_to_custom_pipe(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_custom_pipe(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_custom_pipe(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre pipeline_delete_impact.
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = p_pipeline_id AND type = 'custom') THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.pipeline_delete_impact(p_pipeline_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid) TO service_role;

COMMENT ON FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid) IS 'Prévia do que delete_custom_pipeline vai destruir. Read-only. Autorização por org do chamador ou master.';

CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre delete_pipeline.
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = p_pipeline_id AND type = 'custom') THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.delete_pipeline(p_pipeline_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid) TO service_role;

COMMENT ON FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid) IS 'HARD DELETE de funil customizado, transacional. Recusa (P0001) se algum card de OUTRO funil estiver numa etapa deste — repontuar dispararia automação, apagar destruiria card alheio. Apaga entries/etapas/membros/transições, o espelho em pipelines e — por CASCADE — pipeline_stage_events (IRREVERSÍVEL, ADR-0017). Leads sobrevivem.';

CREATE OR REPLACE FUNCTION public.delete_system_pipeline(p_org_id uuid, p_pipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_impact      jsonb;
  v_wf          integer := 0;
  v_cop         integer := 0;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  -- O registro é a fonte da verdade sobre "a org tem este funil". Sem linha,
  -- não há o que excluir — e recusar é melhor que devolver sucesso vazio.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_display_config
     WHERE organization_id = p_org_id AND pipe_type = p_pipe_type
  ) THEN
    RAISE EXCEPTION 'esta organização não tem o funil %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  -- SCRUM-626: wrapper fino; resolução de REGISTRO (ver nota de lint no §4).
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type
     AND type <> 'custom'
     FOR UPDATE;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN public.delete_pipeline(v_pipeline_id);
  END IF;

  -- RAMO LEGADO sem linha em pipelines (só 'upsell' alcança — ver impact).
  -- Reproduz o baseline com v_pipeline_id NULL: sem cards, sem blast_plans
  -- (o UPDATE era gateado em id NOT NULL), sem linha em pipelines.
  v_impact := public.system_pipeline_delete_impact(p_org_id, p_pipe_type);

  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = p_org_id
     AND w.is_active
     AND w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  UPDATE public.copilot_agents
     SET active_pipes  = active_pipes - p_pipe_type,
         active_stages = COALESCE(active_stages, '{}'::jsonb) - p_pipe_type,
         updated_at    = now()
   WHERE organization_id = p_org_id
     AND active_pipes ? p_pipe_type;
  GET DIAGNOSTICS v_cop = ROW_COUNT;

  DELETE FROM public.pipe_dispatch_rule_steps
   WHERE rule_id IN (SELECT id FROM public.pipe_dispatch_rules
                      WHERE organization_id = p_org_id AND pipe_type = p_pipe_type);
  DELETE FROM public.pipe_dispatch_rules
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.pipe_distribution_rules
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.scheduled_pipe_messages
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.sla_configs
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  DELETE FROM public.pipeline_stages
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  DELETE FROM public.pipeline_display_config
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE do registro não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', 0,
    'agentes_ajustados',      v_cop
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_system_pipeline(p_org_id uuid, p_pipe_type text) TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_system_pipeline(p_org_id uuid, p_pipe_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_system_pipeline(p_org_id uuid, p_pipe_type text) TO service_role;

COMMENT ON FUNCTION public.delete_system_pipeline(p_org_id uuid, p_pipe_type text) IS 'HARD DELETE de funil de sistema numa org, transacional. Ordem obrigatória cards -> etapas -> pipelines -> registro: inverter congela leads.pipe_whatsapp apontando para funil inexistente. Apaga pipeline_stage_events por CASCADE (IRREVERSÍVEL, ADR-0017). Leads sobrevivem sem posição. Desativa automações (casa slug COM e SEM prefixo, e o uuid), neutraliza disparos em voo e tira o funil dos agentes de Copilot.';

CREATE OR REPLACE FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- SCRUM-626: wrapper fino sobre o motor único.
  SELECT public.get_pipeline_lead_ids(
    p_pipeline_id            => p_pipeline_id,
    p_stage_id               => p_stage_id,
    p_search                 => p_search,
    p_responsible_id         => p_responsible_id,
    p_tag_ids                => p_tag_ids,
    p_qualification_tier     => p_qualification_tier,
    p_pre_qualification_tier => p_pre_qualification_tier,
    p_origin                 => p_origin,
    p_organization_id        => p_organization_id
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid, p_search text, p_responsible_id uuid, p_tag_ids uuid[], p_qualification_tier text[], p_pre_qualification_tier text[], p_origin text[], p_organization_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid, p_search text, p_responsible_id uuid, p_tag_ids uuid[], p_qualification_tier text[], p_pre_qualification_tier text[], p_origin text[], p_organization_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid, p_search text, p_responsible_id uuid, p_tag_ids uuid[], p_qualification_tier text[], p_pre_qualification_tier text[], p_origin text[], p_organization_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid, p_search text, p_responsible_id uuid, p_tag_ids uuid[], p_qualification_tier text[], p_pre_qualification_tier text[], p_origin text[], p_organization_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid, p_search text, p_responsible_id uuid, p_tag_ids uuid[], p_qualification_tier text[], p_pre_qualification_tier text[], p_origin text[], p_organization_id uuid) TO service_role;

COMMENT ON FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid, p_search text, p_responsible_id uuid, p_tag_ids uuid[], p_qualification_tier text[], p_pre_qualification_tier text[], p_origin text[], p_organization_id uuid) IS 'Disparos: lead_ids de um funil CUSTOM com as condições do wizard. p_organization_id AUTORIZA (ramo master) e ESCOPA (SCRUM-429).';

CREATE OR REPLACE FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(stage_id uuid, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre o motor único.
  RETURN QUERY
  SELECT c.stage_id, SUM(c.cnt)::BIGINT
    FROM public.get_pipeline_stage_counts_by_id(p_pipeline_id, p_org_id, p_search) c
   GROUP BY c.stage_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text) TO service_role;

CREATE OR REPLACE FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  -- SCRUM-626: wrapper fino. `type <> 'custom'` = resolução de REGISTRO, não
  -- métrica (racional dos allows do baseline), na forma que dispensa allow novo.
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type
     AND type <> 'custom';

  IF v_pipeline_id IS NOT NULL THEN
    RETURN public.pipeline_delete_impact(v_pipeline_id);
  END IF;

  -- RAMO LEGADO sem linha em pipelines — medido 2026-09-02: só 'upsell' chega
  -- aqui (105/105 órfãs); Carteira não tem tabela de cards. Reproduz o shape
  -- do baseline com v_pipeline_id NULL (subconsultas por id = 0).
  RETURN jsonb_build_object(
    'pipe_type',   p_pipe_type,
    'pipeline_id', NULL,
    'cards',       0,
    'leads',       0,
    'etapas',
      (SELECT count(*) FROM public.pipeline_stages
        WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type),
    'eventos_etapa', 0,
    'vendas_orfas',  0,
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = p_org_id
          AND w.is_active
          AND w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type)),
    'regras_dispatch',
      (SELECT count(*) FROM public.pipe_dispatch_rules
        WHERE organization_id = p_org_id AND pipe_type = p_pipe_type),
    'regras_distribuicao',
      (SELECT count(*) FROM public.pipe_distribution_rules
        WHERE organization_id = p_org_id AND pipe_type = p_pipe_type),
    'mensagens_agendadas',
      (SELECT count(*) FROM public.scheduled_pipe_messages
        WHERE organization_id = p_org_id
          AND pipe_type = p_pipe_type
          AND status IN ('pending', 'waiting')),
    'agentes_copilot',
      (SELECT count(*) FROM public.copilot_agents
        WHERE organization_id = p_org_id AND active_pipes ? p_pipe_type)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text) TO postgres;
GRANT EXECUTE ON FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text) TO service_role;

COMMENT ON FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text) IS 'Prévia do que delete_system_pipeline vai destruir. Read-only. Autorização por org do chamador ou master.';

CREATE OR REPLACE FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text)
 RETURNS stage_role
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT (
    CASE p_pipeline_type
      WHEN 'whatsapp' THEN
        CASE p_stage_key
          WHEN 'agendado' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          -- `nao_compareceu` era 'lost' aqui. Falta não é perda — ver o
          -- cabeçalho. Cai no ELSE, igual ao funil `confirmacao`.
          ELSE 'open'
        END
      WHEN 'confirmacao' THEN
        CASE p_stage_key
          WHEN 'reuniao_marcada' THEN 'meeting_booked'
          WHEN 'confirmar_d5' THEN 'meeting_booked'
          WHEN 'confirmar_d3' THEN 'meeting_booked'
          WHEN 'confirmar_d2' THEN 'meeting_booked'
          WHEN 'confirmar_d1' THEN 'meeting_booked'
          WHEN 'confirmacao_no_dia' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          WHEN 'perdido' THEN 'lost'
          ELSE 'open'
        END
      WHEN 'propostas' THEN
        CASE p_stage_key
          WHEN 'vendido' THEN 'won'
          WHEN 'perdido' THEN 'lost'
          ELSE 'open'
        END
      ELSE 'open'
    END
  )::public.stage_role
$function$;

GRANT EXECUTE ON FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text) TO postgres;
GRANT EXECUTE ON FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text) TO anon;
GRANT EXECUTE ON FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text) TO service_role;

COMMENT ON FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text) IS 'Papel canônico da etapa de sistema. Falta a reunião (nao_compareceu / no_show) é `open` em TODOS os funis: o lead segue vivo e precisa de nova data. Só `perdido` e `vendido` encerram.';


COMMIT;

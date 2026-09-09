-- ROLLBACK de 20271003000000_os_espelhos_delegam.sql
--
-- Restaura os 8 INSTEAD OF de INSERT/UPDATE das entradas ao corpo que estava em
-- PRODUÇÃO antes do passo 2, capturado por pg_get_functiondef em 2026-09-04 —
-- não transcrito à mão, e não lido do repositório, que mente sobre corpo de
-- função.
--
-- Seguro a qualquer momento: os corpos abaixo não dependem das funções
-- compartilhadas do passo 1. Rodar este rollback DEPOIS do passo 3 devolve os
-- triggers ao estado antigo mas NÃO desfaz o passo 3 — para reverter tudo, rode
-- o rollback do passo 3 primeiro.

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
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

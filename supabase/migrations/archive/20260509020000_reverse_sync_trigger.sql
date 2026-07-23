-- Phase 2: Reverse sync trigger (pipeline_entries → legacy pipe tables)
-- Keeps legacy tables in sync when frontend writes directly to pipeline_entries.
-- Uses pg_trigger_depth() to prevent circular execution with the forward trigger.

-- Step 1: Add depth guard to existing forward trigger
CREATE OR REPLACE FUNCTION public.sync_legacy_pipe_to_entries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id UUID;
  v_slug TEXT;
  v_metadata JSONB := '{}';
  v_org_id UUID;
BEGIN
  -- Prevent circular trigger execution (reverse trigger → legacy write → this trigger)
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  v_slug := CASE TG_TABLE_NAME
    WHEN 'pipe_whatsapp' THEN 'whatsapp'
    WHEN 'pipe_confirmacao' THEN 'confirmacao'
    WHEN 'pipe_propostas' THEN 'propostas'
  END;

  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
  ELSE
    v_org_id := NEW.organization_id;
  END IF;

  IF v_slug IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = v_org_id AND slug = v_slug AND type = 'system';

  IF v_pipeline_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipeline_entries WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'pipe_whatsapp' THEN
    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'scheduled_date', NEW.scheduled_date,
      'sdr_id', NEW.sdr_id,
      'responsible_id', NEW.responsible_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id
    ));
  ELSIF TG_TABLE_NAME = 'pipe_confirmacao' THEN
    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'meeting_date', NEW.meeting_date,
      'meet_link', NEW.meet_link,
      'is_confirmed', NEW.is_confirmed,
      'sdr_id', NEW.sdr_id,
      'closer_id', NEW.closer_id,
      'responsible_id', NEW.responsible_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'metrics_period_at', NEW.metrics_period_at
    ));
  ELSIF TG_TABLE_NAME = 'pipe_propostas' THEN
    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'sale_value', NEW.sale_value,
      'product_type', NEW.product_type,
      'product_id', NEW.product_id,
      'calor', NEW.calor,
      'loss_reason_id', NEW.loss_reason_id,
      'commitment_date', NEW.commitment_date,
      'contract_duration', NEW.contract_duration,
      'closer_id', NEW.closer_id,
      'responsible_id', NEW.responsible_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'metrics_period_at', NEW.metrics_period_at
    ));
  END IF;

  DELETE FROM public.pipeline_entries WHERE id = NEW.id;

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, stage_key,
    assigned_to, notes, metadata,
    entered_at, stage_changed_at, closed_at,
    created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, v_pipeline_id, NEW.lead_id, NEW.status,
    COALESCE(NEW.responsible_id, NEW.sdr_id),
    NEW.notes, v_metadata, NEW.created_at, NEW.updated_at,
    CASE WHEN TG_TABLE_NAME = 'pipe_propostas' THEN NEW.closed_at ELSE NULL END,
    NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
    id = EXCLUDED.id,
    stage_key = EXCLUDED.stage_key,
    assigned_to = EXCLUDED.assigned_to,
    notes = EXCLUDED.notes,
    metadata = EXCLUDED.metadata,
    stage_changed_at = EXCLUDED.stage_changed_at,
    closed_at = EXCLUDED.closed_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$function$;

-- Step 2: Create reverse sync trigger function
CREATE OR REPLACE FUNCTION public.sync_entries_to_legacy_pipes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_slug TEXT;
  v_meta JSONB;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT slug INTO v_slug
  FROM public.pipelines
  WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.pipeline_id ELSE NEW.pipeline_id END)
    AND type = 'system';

  IF v_slug IS NULL OR v_slug NOT IN ('whatsapp', 'confirmacao', 'propostas') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- DELETE
  IF TG_OP = 'DELETE' THEN
    CASE v_slug
      WHEN 'whatsapp' THEN DELETE FROM pipe_whatsapp WHERE id = OLD.id;
      WHEN 'confirmacao' THEN DELETE FROM pipe_confirmacao WHERE id = OLD.id;
      WHEN 'propostas' THEN DELETE FROM pipe_propostas WHERE id = OLD.id;
    END CASE;
    RETURN OLD;
  END IF;

  v_meta := COALESCE(NEW.metadata, '{}'::jsonb);

  -- UPSERT into legacy table
  CASE v_slug
    WHEN 'whatsapp' THEN
      INSERT INTO pipe_whatsapp (
        id, lead_id, organization_id, status,
        sdr_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
        scheduled_date, notes
      ) VALUES (
        NEW.id, NEW.lead_id, NEW.organization_id, NEW.stage_key,
        (v_meta->>'sdr_id')::uuid,
        (v_meta->>'responsible_id')::uuid,
        (v_meta->>'pre_sale_responsible_id')::uuid,
        (v_meta->>'sale_responsible_id')::uuid,
        (v_meta->>'scheduled_date')::timestamptz,
        NEW.notes
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        sdr_id = EXCLUDED.sdr_id,
        responsible_id = EXCLUDED.responsible_id,
        pre_sale_responsible_id = EXCLUDED.pre_sale_responsible_id,
        sale_responsible_id = EXCLUDED.sale_responsible_id,
        scheduled_date = EXCLUDED.scheduled_date,
        notes = EXCLUDED.notes,
        updated_at = NOW();

    WHEN 'confirmacao' THEN
      INSERT INTO pipe_confirmacao (
        id, lead_id, organization_id, status,
        sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
        meeting_date, meet_link, is_confirmed, metrics_period_at, notes
      ) VALUES (
        NEW.id, NEW.lead_id, NEW.organization_id, NEW.stage_key,
        (v_meta->>'sdr_id')::uuid,
        (v_meta->>'closer_id')::uuid,
        (v_meta->>'responsible_id')::uuid,
        (v_meta->>'pre_sale_responsible_id')::uuid,
        (v_meta->>'sale_responsible_id')::uuid,
        (v_meta->>'meeting_date')::timestamptz,
        v_meta->>'meet_link',
        COALESCE((v_meta->>'is_confirmed')::boolean, false),
        (v_meta->>'metrics_period_at')::timestamptz,
        NEW.notes
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        sdr_id = EXCLUDED.sdr_id,
        closer_id = EXCLUDED.closer_id,
        responsible_id = EXCLUDED.responsible_id,
        pre_sale_responsible_id = EXCLUDED.pre_sale_responsible_id,
        sale_responsible_id = EXCLUDED.sale_responsible_id,
        meeting_date = EXCLUDED.meeting_date,
        meet_link = EXCLUDED.meet_link,
        is_confirmed = EXCLUDED.is_confirmed,
        metrics_period_at = EXCLUDED.metrics_period_at,
        notes = EXCLUDED.notes,
        updated_at = NOW();

    WHEN 'propostas' THEN
      INSERT INTO pipe_propostas (
        id, lead_id, organization_id, status,
        closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
        sale_value, product_type, product_id, calor, loss_reason_id,
        commitment_date, contract_duration, metrics_period_at, closed_at, notes
      ) VALUES (
        NEW.id, NEW.lead_id, NEW.organization_id, NEW.stage_key,
        (v_meta->>'closer_id')::uuid,
        (v_meta->>'responsible_id')::uuid,
        (v_meta->>'pre_sale_responsible_id')::uuid,
        (v_meta->>'sale_responsible_id')::uuid,
        (v_meta->>'sale_value')::numeric,
        (v_meta->>'product_type')::product_type,
        (v_meta->>'product_id')::uuid,
        (v_meta->>'calor')::integer,
        (v_meta->>'loss_reason_id')::uuid,
        (v_meta->>'commitment_date')::timestamptz,
        (v_meta->>'contract_duration')::integer,
        (v_meta->>'metrics_period_at')::timestamptz,
        NEW.closed_at,
        NEW.notes
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        closer_id = EXCLUDED.closer_id,
        responsible_id = EXCLUDED.responsible_id,
        pre_sale_responsible_id = EXCLUDED.pre_sale_responsible_id,
        sale_responsible_id = EXCLUDED.sale_responsible_id,
        sale_value = EXCLUDED.sale_value,
        product_type = EXCLUDED.product_type,
        product_id = EXCLUDED.product_id,
        calor = EXCLUDED.calor,
        loss_reason_id = EXCLUDED.loss_reason_id,
        commitment_date = EXCLUDED.commitment_date,
        contract_duration = EXCLUDED.contract_duration,
        metrics_period_at = EXCLUDED.metrics_period_at,
        closed_at = EXCLUDED.closed_at,
        notes = EXCLUDED.notes,
        updated_at = NOW();
  END CASE;

  RETURN NEW;
END;
$function$;

-- Step 3: Attach reverse trigger to pipeline_entries
DROP TRIGGER IF EXISTS trg_sync_entries_to_legacy ON pipeline_entries;
CREATE TRIGGER trg_sync_entries_to_legacy
  AFTER INSERT OR UPDATE OR DELETE ON pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION sync_entries_to_legacy_pipes();

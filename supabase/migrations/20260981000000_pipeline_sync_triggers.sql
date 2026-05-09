-- ============================================================================
-- Pipeline Sync Triggers
-- ============================================================================
-- Keeps pipeline_entries in sync when writes go to legacy pipe_* tables.
-- Direction: pipe_whatsapp/pipe_confirmacao/pipe_propostas → pipeline_entries
-- Also runs initial data migration if not already done.
-- ============================================================================

-- ============================================================================
-- 1. Generic sync function (handles all three system pipes)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_legacy_pipe_to_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  v_slug TEXT;
  v_metadata JSONB := '{}';
  v_org_id UUID;
BEGIN
  -- Determine slug from trigger table
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

  -- Resolve pipeline_id
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = v_org_id
    AND slug = v_slug
    AND type = 'system';

  IF v_pipeline_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- DELETE
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipeline_entries WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  -- Build metadata based on table
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

  -- Delete any existing entry for this legacy record, then upsert by (pipeline, lead)
  DELETE FROM public.pipeline_entries WHERE id = NEW.id;

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, stage_key,
    assigned_to, notes, metadata,
    entered_at, stage_changed_at, closed_at,
    created_at, updated_at
  ) VALUES (
    NEW.id,
    NEW.organization_id,
    v_pipeline_id,
    NEW.lead_id,
    NEW.status,
    COALESCE(NEW.responsible_id, NEW.sdr_id),
    NEW.notes,
    v_metadata,
    NEW.created_at,
    NEW.updated_at,
    CASE WHEN TG_TABLE_NAME = 'pipe_propostas' THEN NEW.closed_at ELSE NULL END,
    NEW.created_at,
    NEW.updated_at
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
$$;

-- ============================================================================
-- 2. Create triggers on each legacy pipe table
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_pipe_whatsapp_to_entries ON public.pipe_whatsapp;
CREATE TRIGGER trg_sync_pipe_whatsapp_to_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_pipe_to_entries();

DROP TRIGGER IF EXISTS trg_sync_pipe_confirmacao_to_entries ON public.pipe_confirmacao;
CREATE TRIGGER trg_sync_pipe_confirmacao_to_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_pipe_to_entries();

DROP TRIGGER IF EXISTS trg_sync_pipe_propostas_to_entries ON public.pipe_propostas;
CREATE TRIGGER trg_sync_pipe_propostas_to_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_pipe_to_entries();

-- ============================================================================
-- 3. Custom pipe entries sync
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_custom_pipe_to_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipeline_entries WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  -- Resolve stage_key from custom_pipeline_stages
  SELECT stage_key INTO v_stage_key
  FROM public.custom_pipeline_stages
  WHERE id = NEW.stage_id;

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, stage_key,
    assigned_to, notes, metadata,
    entered_at, stage_changed_at,
    created_at, updated_at
  ) VALUES (
    NEW.id,
    NEW.organization_id,
    NEW.pipeline_id,
    NEW.lead_id,
    COALESCE(v_stage_key, 'unknown'),
    NEW.assigned_to,
    NEW.notes,
    '{}',
    NEW.entered_at,
    NEW.stage_changed_at,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    stage_key = EXCLUDED.stage_key,
    assigned_to = EXCLUDED.assigned_to,
    notes = EXCLUDED.notes,
    stage_changed_at = EXCLUDED.stage_changed_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_custom_pipe_to_entries ON public.custom_pipe_entries;
CREATE TRIGGER trg_sync_custom_pipe_to_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_custom_pipe_to_entries();

-- ============================================================================
-- 4. Fix migrate_pipe_entries: stage_entered_at does not exist on pipe tables
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_pipe_entries(p_batch_size INT DEFAULT 1000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org RECORD;
  v_pipe_wpp_id UUID;
  v_pipe_conf_id UUID;
  v_pipe_prop_id UUID;
  v_wpp_count INT := 0;
  v_conf_count INT := 0;
  v_prop_count INT := 0;
  v_custom_count INT := 0;
  v_batch INT;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP

    SELECT id INTO v_pipe_wpp_id
    FROM public.pipelines
    WHERE organization_id = v_org.id AND slug = 'whatsapp' AND type = 'system';

    SELECT id INTO v_pipe_conf_id
    FROM public.pipelines
    WHERE organization_id = v_org.id AND slug = 'confirmacao' AND type = 'system';

    SELECT id INTO v_pipe_prop_id
    FROM public.pipelines
    WHERE organization_id = v_org.id AND slug = 'propostas' AND type = 'system';

    IF v_pipe_wpp_id IS NULL OR v_pipe_conf_id IS NULL OR v_pipe_prop_id IS NULL THEN
      CONTINUE;
    END IF;

    WITH deduped_wpp AS (
      SELECT DISTINCT ON (pw.lead_id)
        pw.id, pw.organization_id, pw.lead_id, pw.status,
        COALESCE(pw.responsible_id, pw.sdr_id) AS assigned_to,
        pw.notes,
        jsonb_strip_nulls(jsonb_build_object('scheduled_date', pw.scheduled_date)) AS metadata,
        pw.created_at, pw.updated_at
      FROM public.pipe_whatsapp pw
      WHERE pw.organization_id = v_org.id
        AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.id = pw.id)
      ORDER BY pw.lead_id, pw.updated_at DESC
      LIMIT p_batch_size
    ), inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at
      )
      SELECT d.id, d.organization_id, v_pipe_wpp_id, d.lead_id, d.status,
        d.assigned_to, d.notes, d.metadata,
        d.created_at, d.updated_at, d.created_at, d.updated_at
      FROM deduped_wpp d
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pipeline_entries pe
        WHERE pe.pipeline_id = v_pipe_wpp_id AND pe.lead_id = d.lead_id
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_wpp_count := v_wpp_count + v_batch;

    WITH deduped_conf AS (
      SELECT DISTINCT ON (pc.lead_id)
        pc.id, pc.organization_id, pc.lead_id, pc.status,
        COALESCE(pc.responsible_id, pc.sdr_id, pc.closer_id) AS assigned_to,
        pc.notes,
        jsonb_strip_nulls(jsonb_build_object(
          'meeting_date', pc.meeting_date,
          'meet_link', pc.meet_link,
          'is_confirmed', pc.is_confirmed,
          'metrics_period_at', pc.metrics_period_at
        )) AS metadata,
        pc.created_at, pc.updated_at
      FROM public.pipe_confirmacao pc
      WHERE pc.organization_id = v_org.id
        AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.id = pc.id)
      ORDER BY pc.lead_id, pc.updated_at DESC
      LIMIT p_batch_size
    ), inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at
      )
      SELECT d.id, d.organization_id, v_pipe_conf_id, d.lead_id, d.status,
        d.assigned_to, d.notes, d.metadata,
        d.created_at, d.updated_at, d.created_at, d.updated_at
      FROM deduped_conf d
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pipeline_entries pe
        WHERE pe.pipeline_id = v_pipe_conf_id AND pe.lead_id = d.lead_id
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_conf_count := v_conf_count + v_batch;

    WITH deduped_prop AS (
      SELECT DISTINCT ON (pp.lead_id)
        pp.id, pp.organization_id, pp.lead_id, pp.status,
        COALESCE(pp.responsible_id, pp.closer_id) AS assigned_to,
        pp.notes,
        jsonb_strip_nulls(jsonb_build_object(
          'sale_value', pp.sale_value,
          'product_type', pp.product_type,
          'calor', pp.calor,
          'loss_reason_id', pp.loss_reason_id,
          'commitment_date', pp.commitment_date,
          'contract_duration', pp.contract_duration,
          'metrics_period_at', pp.metrics_period_at
        )) AS metadata,
        pp.created_at, pp.updated_at, pp.closed_at
      FROM public.pipe_propostas pp
      WHERE pp.organization_id = v_org.id
        AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.id = pp.id)
      ORDER BY pp.lead_id, pp.updated_at DESC
      LIMIT p_batch_size
    ), inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, metadata, entered_at, stage_changed_at,
        closed_at, created_at, updated_at
      )
      SELECT d.id, d.organization_id, v_pipe_prop_id, d.lead_id, d.status,
        d.assigned_to, d.notes, d.metadata,
        d.created_at, d.updated_at,
        d.closed_at, d.created_at, d.updated_at
      FROM deduped_prop d
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pipeline_entries pe
        WHERE pe.pipeline_id = v_pipe_prop_id AND pe.lead_id = d.lead_id
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_prop_count := v_prop_count + v_batch;

    WITH inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, entered_at, stage_changed_at, created_at, updated_at
      )
      SELECT
        cpe.id, cpe.organization_id, cpe.pipeline_id, cpe.lead_id,
        COALESCE(cps.stage_key, 'unknown'),
        cpe.assigned_to,
        cpe.notes,
        cpe.entered_at, cpe.stage_changed_at,
        cpe.created_at, cpe.updated_at
      FROM public.custom_pipe_entries cpe
      LEFT JOIN public.custom_pipeline_stages cps ON cps.id = cpe.stage_id
      WHERE cpe.organization_id = v_org.id
        AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.id = cpe.id)
      LIMIT p_batch_size
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_custom_count := v_custom_count + v_batch;

  END LOOP;

  RETURN jsonb_build_object(
    'whatsapp_count', v_wpp_count,
    'confirmacao_count', v_conf_count,
    'propostas_count', v_prop_count,
    'custom_count', v_custom_count
  );
END;
$$;

-- Run initial data migration (idempotent)
SELECT public.migrate_pipe_entries(10000);

-- ============================================================================
-- 5. Sync custom_pipelines → pipelines (new custom pipelines)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_custom_pipeline_to_pipelines()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipelines WHERE id = OLD.id AND type = 'custom';
    RETURN OLD;
  END IF;

  INSERT INTO public.pipelines (
    id, organization_id, name, slug, type, description,
    icon, color, display_order, is_active,
    created_by, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.name, NEW.slug, 'custom', NEW.description,
    NEW.icon, NEW.color, NEW.position + 3, NEW.is_active,
    NEW.created_by, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_custom_pipeline ON public.custom_pipelines;
CREATE TRIGGER trg_sync_custom_pipeline
  AFTER INSERT OR UPDATE OR DELETE ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.sync_custom_pipeline_to_pipelines();

-- ============================================================================
-- 6. Ensure all existing custom_pipelines are synced
-- ============================================================================

INSERT INTO public.pipelines (
  id, organization_id, name, slug, type, description,
  icon, color, display_order, is_active, created_by, created_at, updated_at
)
SELECT
  id, organization_id, name, slug, 'custom', description,
  icon, color, position + 3, is_active, created_by, created_at, updated_at
FROM public.custom_pipelines
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  is_active = EXCLUDED.is_active,
  updated_at = EXCLUDED.updated_at;

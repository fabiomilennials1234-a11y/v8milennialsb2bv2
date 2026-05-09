-- ============================================================================
-- FIX: Compat views had stage_id references — column doesn't exist on
-- pipeline_entries. Previous migration (20260983) failed silently.
-- This recreates everything cleanly.
-- ============================================================================

-- Drop existing views (CASCADE drops dependent triggers)
DROP VIEW IF EXISTS public.pipe_whatsapp CASCADE;
DROP VIEW IF EXISTS public.pipe_confirmacao CASCADE;
DROP VIEW IF EXISTS public.pipe_propostas CASCADE;

-- Drop trigger functions (may or may not exist from failed migration)
DROP FUNCTION IF EXISTS public.pipe_whatsapp_insert_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_whatsapp_update_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_whatsapp_delete_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_confirmacao_insert_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_confirmacao_update_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_confirmacao_delete_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_propostas_insert_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_propostas_update_fn() CASCADE;
DROP FUNCTION IF EXISTS public.pipe_propostas_delete_fn() CASCADE;

-- ============================================================
-- 1. pipe_whatsapp view
-- ============================================================
CREATE OR REPLACE VIEW public.pipe_whatsapp AS
SELECT
  pe.id,
  pe.lead_id,
  pe.organization_id,
  pe.stage_key                                       AS status,
  (pe.metadata->>'responsible_id')::uuid             AS responsible_id,
  (pe.metadata->>'sdr_id')::uuid                     AS sdr_id,
  (pe.metadata->>'pre_sale_responsible_id')::uuid     AS pre_sale_responsible_id,
  (pe.metadata->>'sale_responsible_id')::uuid         AS sale_responsible_id,
  (pe.metadata->>'scheduled_date')::timestamptz      AS scheduled_date,
  pe.notes,
  pe.created_at,
  pe.updated_at
FROM public.pipeline_entries pe
JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  AND pip.slug = 'whatsapp' AND pip.type = 'system';

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_insert_fn() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_whatsapp_insert
  INSTEAD OF INSERT ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.pipe_whatsapp_insert_fn();

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_update_fn() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_whatsapp_update
  INSTEAD OF UPDATE ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.pipe_whatsapp_update_fn();

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_delete_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_whatsapp_delete
  INSTEAD OF DELETE ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.pipe_whatsapp_delete_fn();

-- ============================================================
-- 2. pipe_confirmacao view
-- ============================================================
CREATE OR REPLACE VIEW public.pipe_confirmacao AS
SELECT
  pe.id,
  pe.lead_id,
  pe.organization_id,
  pe.stage_key                                                    AS status,
  (pe.metadata->>'meeting_date')::timestamptz                     AS meeting_date,
  COALESCE((pe.metadata->>'is_confirmed')::boolean, false)        AS is_confirmed,
  (pe.metadata->>'closer_id')::uuid                               AS closer_id,
  (pe.metadata->>'responsible_id')::uuid                          AS responsible_id,
  (pe.metadata->>'sdr_id')::uuid                                  AS sdr_id,
  (pe.metadata->>'pre_sale_responsible_id')::uuid                 AS pre_sale_responsible_id,
  (pe.metadata->>'sale_responsible_id')::uuid                     AS sale_responsible_id,
  pe.metadata->>'meet_link'                                       AS meet_link,
  pe.notes,
  (pe.metadata->>'metrics_period_at')::timestamptz                AS metrics_period_at,
  pe.created_at,
  pe.updated_at
FROM public.pipeline_entries pe
JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  AND pip.slug = 'confirmacao' AND pip.type = 'system';

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_insert_fn() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_confirmacao_insert
  INSTEAD OF INSERT ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.pipe_confirmacao_insert_fn();

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_update_fn() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_confirmacao_update
  INSTEAD OF UPDATE ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.pipe_confirmacao_update_fn();

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_delete_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_confirmacao_delete
  INSTEAD OF DELETE ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.pipe_confirmacao_delete_fn();

-- ============================================================
-- 3. pipe_propostas view
-- ============================================================
CREATE OR REPLACE VIEW public.pipe_propostas AS
SELECT
  pe.id,
  pe.lead_id,
  pe.organization_id,
  pe.stage_key                                          AS status,
  (pe.metadata->>'sale_value')::numeric                 AS sale_value,
  (pe.metadata->>'closer_id')::uuid                     AS closer_id,
  (pe.metadata->>'responsible_id')::uuid                AS responsible_id,
  (pe.metadata->>'pre_sale_responsible_id')::uuid       AS pre_sale_responsible_id,
  (pe.metadata->>'sale_responsible_id')::uuid           AS sale_responsible_id,
  (pe.metadata->>'product_id')::uuid                    AS product_id,
  (pe.metadata->>'product_type')::text                  AS product_type,
  (pe.metadata->>'calor')::integer                      AS calor,
  pe.metadata->>'loss_reason'                           AS loss_reason,
  (pe.metadata->>'loss_reason_id')::uuid                AS loss_reason_id,
  (pe.metadata->>'commitment_date')::date               AS commitment_date,
  (pe.metadata->>'contract_duration')::integer          AS contract_duration,
  pe.notes,
  (pe.metadata->>'metrics_period_at')::timestamptz      AS metrics_period_at,
  pe.closed_at,
  pe.created_at,
  pe.updated_at
FROM public.pipeline_entries pe
JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  AND pip.slug = 'propostas' AND pip.type = 'system';

CREATE OR REPLACE FUNCTION public.pipe_propostas_insert_fn() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_propostas_insert
  INSTEAD OF INSERT ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.pipe_propostas_insert_fn();

CREATE OR REPLACE FUNCTION public.pipe_propostas_update_fn() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_propostas_update
  INSTEAD OF UPDATE ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.pipe_propostas_update_fn();

CREATE OR REPLACE FUNCTION public.pipe_propostas_delete_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.pipeline_entries WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE TRIGGER trg_pipe_propostas_delete
  INSTEAD OF DELETE ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.pipe_propostas_delete_fn();

-- ============================================================
-- 4. Grants
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipe_whatsapp    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipe_confirmacao TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipe_propostas   TO authenticated;

GRANT SELECT ON public.pipe_whatsapp    TO anon;
GRANT SELECT ON public.pipe_confirmacao TO anon;
GRANT SELECT ON public.pipe_propostas   TO anon;

-- ============================================================
-- 5. Validation
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'pipe_whatsapp' AND schemaname = 'public') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_whatsapp view not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'pipe_confirmacao' AND schemaname = 'public') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_confirmacao view not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'pipe_propostas' AND schemaname = 'public') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_propostas view not created';
  END IF;
  RAISE NOTICE 'VALIDATION PASSED: All 3 compat views created successfully';
END $$;

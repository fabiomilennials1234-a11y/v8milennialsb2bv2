-- Backfill: sync all legacy pipe_* records into pipeline_entries
-- Deduplicates by (pipeline_id, lead_id), keeping most recent

-- 1. pipe_whatsapp
INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, stage_key,
  assigned_to, notes, metadata,
  entered_at, stage_changed_at, created_at, updated_at
)
SELECT DISTINCT ON (p.id, pw.lead_id)
  pw.id, pw.organization_id, p.id, pw.lead_id, pw.status,
  COALESCE(pw.responsible_id, pw.sdr_id), pw.notes,
  jsonb_strip_nulls(jsonb_build_object(
    'scheduled_date', pw.scheduled_date,
    'sdr_id', pw.sdr_id,
    'responsible_id', pw.responsible_id,
    'pre_sale_responsible_id', pw.pre_sale_responsible_id,
    'sale_responsible_id', pw.sale_responsible_id
  )),
  pw.created_at, pw.updated_at, pw.created_at, pw.updated_at
FROM pipe_whatsapp pw
JOIN pipelines p ON p.organization_id = pw.organization_id AND p.slug = 'whatsapp' AND p.type = 'system'
ORDER BY p.id, pw.lead_id, pw.updated_at DESC
ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
  id = EXCLUDED.id,
  stage_key = EXCLUDED.stage_key,
  assigned_to = EXCLUDED.assigned_to,
  metadata = EXCLUDED.metadata,
  updated_at = EXCLUDED.updated_at;

-- 2. pipe_confirmacao
INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, stage_key,
  assigned_to, notes, metadata,
  entered_at, stage_changed_at, created_at, updated_at
)
SELECT DISTINCT ON (p.id, pc.lead_id)
  pc.id, pc.organization_id, p.id, pc.lead_id, pc.status,
  COALESCE(pc.responsible_id, pc.sdr_id), pc.notes,
  jsonb_strip_nulls(jsonb_build_object(
    'meeting_date', pc.meeting_date,
    'meet_link', pc.meet_link,
    'is_confirmed', pc.is_confirmed,
    'sdr_id', pc.sdr_id,
    'closer_id', pc.closer_id,
    'responsible_id', pc.responsible_id,
    'pre_sale_responsible_id', pc.pre_sale_responsible_id,
    'sale_responsible_id', pc.sale_responsible_id,
    'metrics_period_at', pc.metrics_period_at
  )),
  pc.created_at, pc.updated_at, pc.created_at, pc.updated_at
FROM pipe_confirmacao pc
JOIN pipelines p ON p.organization_id = pc.organization_id AND p.slug = 'confirmacao' AND p.type = 'system'
ORDER BY p.id, pc.lead_id, pc.updated_at DESC
ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
  id = EXCLUDED.id,
  stage_key = EXCLUDED.stage_key,
  assigned_to = EXCLUDED.assigned_to,
  metadata = EXCLUDED.metadata,
  updated_at = EXCLUDED.updated_at;

-- 3. pipe_propostas
INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, stage_key,
  assigned_to, notes, metadata,
  entered_at, stage_changed_at, closed_at,
  created_at, updated_at
)
SELECT DISTINCT ON (p.id, pp.lead_id)
  pp.id, pp.organization_id, p.id, pp.lead_id, pp.status,
  COALESCE(pp.responsible_id, pp.closer_id), pp.notes,
  jsonb_strip_nulls(jsonb_build_object(
    'sale_value', pp.sale_value,
    'product_type', pp.product_type,
    'product_id', pp.product_id,
    'calor', pp.calor,
    'loss_reason_id', pp.loss_reason_id,
    'commitment_date', pp.commitment_date,
    'contract_duration', pp.contract_duration,
    'closer_id', pp.closer_id,
    'responsible_id', pp.responsible_id,
    'pre_sale_responsible_id', pp.pre_sale_responsible_id,
    'sale_responsible_id', pp.sale_responsible_id,
    'metrics_period_at', pp.metrics_period_at
  )),
  pp.created_at, pp.updated_at, pp.closed_at,
  pp.created_at, pp.updated_at
FROM pipe_propostas pp
JOIN pipelines p ON p.organization_id = pp.organization_id AND p.slug = 'propostas' AND p.type = 'system'
ORDER BY p.id, pp.lead_id, pp.updated_at DESC
ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
  id = EXCLUDED.id,
  stage_key = EXCLUDED.stage_key,
  assigned_to = EXCLUDED.assigned_to,
  metadata = EXCLUDED.metadata,
  closed_at = EXCLUDED.closed_at,
  updated_at = EXCLUDED.updated_at;

-- 4. Fix empty metadata on previously synced entries
UPDATE public.pipeline_entries pe SET
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'scheduled_date', pw.scheduled_date,
    'sdr_id', pw.sdr_id,
    'responsible_id', pw.responsible_id,
    'pre_sale_responsible_id', pw.pre_sale_responsible_id,
    'sale_responsible_id', pw.sale_responsible_id
  ))
FROM pipe_whatsapp pw
JOIN pipelines p ON p.organization_id = pw.organization_id AND p.slug = 'whatsapp' AND p.type = 'system'
WHERE pe.id = pw.id AND pe.pipeline_id = p.id AND pe.metadata = '{}';

UPDATE public.pipeline_entries pe SET
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'meeting_date', pc.meeting_date,
    'meet_link', pc.meet_link,
    'is_confirmed', pc.is_confirmed,
    'sdr_id', pc.sdr_id,
    'closer_id', pc.closer_id,
    'responsible_id', pc.responsible_id,
    'pre_sale_responsible_id', pc.pre_sale_responsible_id,
    'sale_responsible_id', pc.sale_responsible_id,
    'metrics_period_at', pc.metrics_period_at
  ))
FROM pipe_confirmacao pc
JOIN pipelines p ON p.organization_id = pc.organization_id AND p.slug = 'confirmacao' AND p.type = 'system'
WHERE pe.id = pc.id AND pe.pipeline_id = p.id AND pe.metadata = '{}';

UPDATE public.pipeline_entries pe SET
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'sale_value', pp.sale_value,
    'product_type', pp.product_type,
    'product_id', pp.product_id,
    'calor', pp.calor,
    'loss_reason_id', pp.loss_reason_id,
    'commitment_date', pp.commitment_date,
    'contract_duration', pp.contract_duration,
    'closer_id', pp.closer_id,
    'responsible_id', pp.responsible_id,
    'pre_sale_responsible_id', pp.pre_sale_responsible_id,
    'sale_responsible_id', pp.sale_responsible_id,
    'metrics_period_at', pp.metrics_period_at
  ))
FROM pipe_propostas pp
JOIN pipelines p ON p.organization_id = pp.organization_id AND p.slug = 'propostas' AND p.type = 'system'
WHERE pe.id = pp.id AND pe.pipeline_id = p.id AND pe.metadata = '{}';

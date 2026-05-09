-- Backfill pipeline_entries metadata from legacy pipe_* tables
-- NOTE: The INSERT backfill is skipped because migrate_pipe_entries(10000)
-- already ran in 20260981000000_pipeline_sync_triggers.sql.
-- Only metadata enrichment is needed for entries synced with empty metadata.

-- 1. Enrich whatsapp entries metadata
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

-- 2. Enrich confirmacao entries metadata
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

-- 3. Enrich propostas entries metadata
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

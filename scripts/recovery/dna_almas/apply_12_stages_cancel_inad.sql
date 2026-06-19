-- apply_12_stages_cancel_inad.sql
-- Onda 2 — stages cancelado + inadimplente no pipe whatsapp da DNA. Idempotente.
INSERT INTO public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
VALUES
 ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','cancelado','🔴 Cancelado',21,true),
 ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','inadimplente','⚠️ Inadimplente',22,true)
ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING
RETURNING stage_key, name, position, is_active;

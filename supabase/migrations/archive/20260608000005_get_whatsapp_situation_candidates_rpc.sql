-- 20260608000005_get_whatsapp_situation_candidates_rpc.sql
-- Candidate sourcing for the Oportunidades (whatsapp) follow-up situations
-- (ADR-0006): new_lead_no_reply, qualified_no_meeting, cold_reengage,
-- no_show_rebook. Returns the whatsapp stage + last in/out + stage_changed_at.

CREATE OR REPLACE FUNCTION public.get_whatsapp_situation_candidates(
  p_organization_id uuid,
  p_stage_keys text[]
)
RETURNS TABLE (
  lead_id uuid,
  whatsapp_stage text,
  stage_changed_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH wf AS (
    SELECT pe.lead_id, pe.stage_key, pe.stage_changed_at
    FROM pipeline_entries pe
    JOIN pipelines p ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
    WHERE pe.organization_id = p_organization_id
      AND pe.stage_key = ANY(p_stage_keys)
  )
  SELECT
    w.lead_id,
    w.stage_key AS whatsapp_stage,
    w.stage_changed_at,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id = w.lead_id AND wm.organization_id = p_organization_id
         AND wm.direction = 'incoming') AS last_inbound_at,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id = w.lead_id AND wm.organization_id = p_organization_id
         AND wm.direction = 'outgoing') AS last_outbound_at
  FROM wf w;
$$;

COMMENT ON FUNCTION public.get_whatsapp_situation_candidates IS
  'Leads in given Oportunidades (whatsapp) stages with last in/out message + stage_changed_at. Consumed by the situation follow-up worker (ADR-0006).';

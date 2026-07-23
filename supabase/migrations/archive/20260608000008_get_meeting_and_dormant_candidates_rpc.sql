-- 20260608000008_get_meeting_and_dormant_candidates_rpc.sql
-- Candidate sourcing for the last two Follow-up situations (ADR-0006):
-- meeting_reminder (future scheduled_date in pipeline_entries.metadata) and
-- dormant_winback (carteira clients in the configured segments).

CREATE OR REPLACE FUNCTION public.get_meeting_reminder_candidates(
  p_organization_id uuid, p_stage_keys text[])
RETURNS TABLE (lead_id uuid, whatsapp_stage text, meeting_date timestamptz,
               last_inbound_at timestamptz, last_outbound_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH wf AS (
    SELECT pe.lead_id, pe.stage_key, (pe.metadata->>'scheduled_date')::timestamptz AS meeting_date
    FROM pipeline_entries pe
    JOIN pipelines p ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
    WHERE pe.organization_id = p_organization_id AND pe.stage_key = ANY(p_stage_keys)
      AND pe.metadata->>'scheduled_date' IS NOT NULL
      AND (pe.metadata->>'scheduled_date')::timestamptz > now()
  )
  SELECT w.lead_id, w.stage_key, w.meeting_date,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='incoming'),
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='outgoing')
  FROM wf w;
$$;

CREATE OR REPLACE FUNCTION public.get_dormant_winback_candidates(
  p_organization_id uuid, p_segments text[])
RETURNS TABLE (lead_id uuid, carteira_segment text, last_order_at timestamptz,
               last_inbound_at timestamptz, last_outbound_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT uc.lead_id, uc.segment, uc.last_order_at,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm WHERE wm.lead_id=uc.lead_id AND wm.organization_id=p_organization_id AND wm.direction='incoming'),
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm WHERE wm.lead_id=uc.lead_id AND wm.organization_id=p_organization_id AND wm.direction='outgoing')
  FROM upsell_clients uc
  WHERE uc.organization_id = p_organization_id AND uc.lead_id IS NOT NULL AND uc.segment = ANY(p_segments);
$$;

COMMENT ON FUNCTION public.get_meeting_reminder_candidates IS 'meeting_reminder candidates (ADR-0006).';
COMMENT ON FUNCTION public.get_dormant_winback_candidates IS 'dormant_winback candidates by carteira segment (ADR-0006).';

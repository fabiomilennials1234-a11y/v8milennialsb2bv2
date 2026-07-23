-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

CREATE OR REPLACE FUNCTION public.get_meeting_reminder_candidates(p_organization_id uuid, p_stage_keys text[])
 RETURNS TABLE(lead_id uuid, whatsapp_stage text, meeting_date timestamp with time zone, last_inbound_at timestamp with time zone, last_outbound_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH wf AS (
    SELECT pe.lead_id, pe.stage_key, (pe.metadata->>'scheduled_date')::timestamptz AS meeting_date
    FROM pipeline_entries pe
    JOIN pipelines p ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
    WHERE pe.organization_id = p_organization_id
      AND pe.stage_key = ANY(p_stage_keys)
      AND pe.metadata->>'scheduled_date' IS NOT NULL
      AND (pe.metadata->>'scheduled_date')::timestamptz > now()
  )
  SELECT w.lead_id, w.stage_key, w.meeting_date,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='incoming'),
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='outgoing')
  FROM wf w;
$function$;

-- 20260608000003_get_proposal_no_reply_candidates_rpc.sql
-- Candidate sourcing for the situation follow-up worker (ADR-0006), slice 1.
-- Leads in the org's proposal_no_reply trigger stages, with last inbound/
-- outbound message timestamps so the worker can build SituationLeadState.

CREATE OR REPLACE FUNCTION public.get_proposal_no_reply_candidates(
  p_organization_id uuid,
  p_stage_keys text[]
)
RETURNS TABLE (
  lead_id uuid,
  propostas_stage text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prop AS (
    SELECT pe.lead_id, pe.stage_key
    FROM pipeline_entries pe
    JOIN pipelines p ON p.id = pe.pipeline_id AND p.slug = 'propostas' AND p.type = 'system'
    WHERE pe.organization_id = p_organization_id
      AND pe.stage_key = ANY(p_stage_keys)
  )
  SELECT
    pr.lead_id,
    pr.stage_key AS propostas_stage,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id = pr.lead_id AND wm.organization_id = p_organization_id
         AND wm.direction = 'incoming') AS last_inbound_at,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id = pr.lead_id AND wm.organization_id = p_organization_id
         AND wm.direction = 'outgoing') AS last_outbound_at
  FROM prop pr;
$$;

COMMENT ON FUNCTION public.get_proposal_no_reply_candidates IS
  'Leads in the proposal_no_reply trigger stages for an org, with last inbound/outbound message timestamps. Consumed by the situation follow-up worker (ADR-0006).';

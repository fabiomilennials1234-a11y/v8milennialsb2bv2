-- PROPOSAL ONLY — NOT PART OF THE CAPACITY ROLLOUT. Do not apply tomorrow
-- without an explicit backlog/LLM budget: 25,900 eligible conversations were
-- measured on 2026-09-23. This file intentionally lives outside migrations/.
-- Repair ambiguous OUT-column names in the INSERT conflict target.
-- IMPORTANT: restoring this worker enables pending summary generation and its
-- existing per-item Edge/LLM cost. Deploy separately if capacity budget is tight.
-- Constraint name verified in production 2026-09-23. No claim executed in prod.
CREATE OR REPLACE FUNCTION public.claim_conversation_summary_jobs(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, organization_id uuid, lead_id uuid, instance_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.conversation_summary_jobs AS j
    (organization_id, lead_id, instance_id, last_message_at)
  SELECT w.organization_id, w.lead_id, w.instance_id, w.last_message_time
  FROM public.whatsapp_conversation_summary w
  LEFT JOIN public.conversation_summaries s
    ON s.organization_id = w.organization_id
   AND s.lead_id = w.lead_id
   AND s.instance_id = w.instance_id
  WHERE w.lead_id IS NOT NULL
    AND NOT w.is_group
    AND w.last_message_time < now() - interval '1 hour'
    AND (s.id IS NULL OR s.source_last_message_at IS NULL OR s.source_last_message_at < w.last_message_time)
  ON CONFLICT ON CONSTRAINT conversation_summary_jobs_organization_id_lead_id_instance__key DO UPDATE
    SET last_message_at = EXCLUDED.last_message_at,
        status = 'pending', attempts = 0, next_attempt_at = now(),
        lease_until = NULL, last_error = NULL, updated_at = now()
  WHERE EXCLUDED.last_message_at > j.last_message_at;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.conversation_summary_jobs j
    WHERE (j.status = 'pending' AND j.next_attempt_at <= now())
       OR (j.status = 'processing' AND j.lease_until < now())
    ORDER BY j.last_message_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
  ), claimed AS (
    UPDATE public.conversation_summary_jobs j
    SET status = 'processing', attempts = j.attempts + 1,
        lease_until = now() + interval '10 minutes', updated_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.id, j.organization_id, j.lead_id, j.instance_id
  )
  SELECT c.id, c.organization_id, c.lead_id, c.instance_id FROM claimed c;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_conversation_summary_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_summary_jobs(integer) TO service_role;

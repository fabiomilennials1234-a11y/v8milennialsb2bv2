-- claim_copilot_batch passa a ser retry/reclaim-aware (espelha
-- _shared/copilot/queue-policy.ts isClaimable):
--   - pending elegível só quando next_attempt_at venceu (respeita backoff)
--   - reclaim de processing preso além do lease (worker morto mid-flight)
--   - seta claimed_at no claim (detecção de lease)
-- p_lease_seconds default mantém compat com callers existentes (absorb-loop
-- do agent-message passa só p_batch_key).
CREATE OR REPLACE FUNCTION public.claim_copilot_batch(p_batch_key text, p_lease_seconds int DEFAULT 120)
 RETURNS SETOF copilot_message_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE copilot_message_queue
  SET status = 'processing', claimed_at = now()
  WHERE id IN (
    SELECT id
    FROM copilot_message_queue
    WHERE batch_key = p_batch_key
      AND (
        (status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
        OR
        (status = 'processing'
          AND claimed_at IS NOT NULL
          AND claimed_at < now() - make_interval(secs => p_lease_seconds))
      )
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;

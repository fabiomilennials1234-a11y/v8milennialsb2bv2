-- Proven failures conclude the node; ambiguous delivery never authorizes a resend.
ALTER TABLE public.workflow_button_questions ADD COLUMN failure_reason text;
CREATE FUNCTION public.fail_workflow_button_question(p_id uuid,p_organization_id uuid,p_reason text,p_message_id text DEFAULT NULL,p_accepted_at timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE q public.workflow_button_questions; e public.workflow_executions; target text;
BEGIN
  IF p_reason NOT IN ('provider_rejected','send_preflight_failed','image_unavailable') THEN RAISE EXCEPTION 'question_failure_reason_invalid'; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO e FROM public.workflow_executions WHERE id=q.execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR e.status<>'paused' OR e.current_node_id<>q.node_id THEN RETURN false; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id FOR UPDATE;
  IF q.state NOT IN ('sending','uncertain','waiting') THEN RETURN false; END IF;
  IF q.state IN ('sending','uncertain') AND nullif(p_message_id,'') IS NOT NULL AND p_accepted_at IS NOT NULL THEN
    UPDATE public.workflow_button_questions SET state='waiting',outbound_message_id=p_message_id,
      accepted_at=p_accepted_at,deadline_at=p_accepted_at+(timeout_hours*interval '1 hour')
      WHERE id=q.id RETURNING * INTO q;
  END IF;
  -- An eligible already-admitted answer is stronger evidence than a late provider failure.
  IF q.state='waiting' AND EXISTS(SELECT 1 FROM public.workflow_button_ingress i
    WHERE i.question_id=q.id AND i.organization_id=p_organization_id AND i.instance_id=q.instance_id
      AND i.received_at<q.deadline_at AND ((i.kind='other' AND i.received_at>=q.accepted_at) OR (i.kind='reply' AND i.quoted=q.outbound_message_id
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.options) o WHERE o->>'id'=i.option_id)))) THEN
    RETURN public.resolve_workflow_button_question(q.id,p_organization_id);
  END IF;
  target:=q.destinations->>'send_failure';
  IF target IS NULL THEN RAISE EXCEPTION 'question_destination_unavailable'; END IF;
  UPDATE public.workflow_button_questions SET state='resolved',selected_handle='send_failure',failure_reason=p_reason,resolved_at=clock_timestamp() WHERE id=q.id;
  INSERT INTO public.workflow_execution_steps(execution_id,node_id,node_type,node_label,status,output_data)
    VALUES(e.id,q.node_id,'question_buttons','Pergunta com botões','success',jsonb_build_object('question_id',q.id,'branch','send_failure','reason',p_reason));
  UPDATE public.workflow_executions SET status='running',current_node_id=target,next_run_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=e.id AND organization_id=p_organization_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fail_workflow_button_question(uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_workflow_button_question(uuid,uuid,text,text,timestamptz) TO service_role;

ALTER TABLE public.workflow_button_questions
  ADD COLUMN send_check_count integer NOT NULL DEFAULT 0 CHECK(send_check_count>=0),
  ADD COLUMN next_send_check_at timestamptz,
  ADD COLUMN last_send_check text;
CREATE INDEX workflow_button_questions_send_checks ON public.workflow_button_questions(next_send_check_at,created_at,id)
  WHERE state IN ('sending','uncertain') AND send_check_count<12;
-- Two-minute grace keeps an in-flight HTTP send out of recovery. Five-minute
-- leases and twelve checks bound provider load. Exhaustion remains uncertain.
CREATE FUNCTION public.claim_workflow_button_send_checks(p_limit integer DEFAULT 5)
RETURNS SETOF public.workflow_button_questions LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT q.id FROM public.workflow_button_questions q
    JOIN public.workflow_executions e ON e.id=q.execution_id AND e.organization_id=q.organization_id
    WHERE q.state IN ('sending','uncertain') AND q.send_check_count<12
      AND q.created_at<=clock_timestamp()-interval '2 minutes'
      AND (q.next_send_check_at IS NULL OR q.next_send_check_at<=clock_timestamp())
      AND e.status='paused' AND e.current_node_id=q.node_id
    ORDER BY q.next_send_check_at NULLS FIRST,q.created_at,q.id
    LIMIT least(greatest(coalesce(p_limit,5),1),5) FOR UPDATE OF q SKIP LOCKED
  ) UPDATE public.workflow_button_questions q SET state='uncertain',send_check_count=q.send_check_count+1,
      next_send_check_at=clock_timestamp()+interval '5 minutes',last_send_check='checking'
    FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_workflow_button_send_checks(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_button_send_checks(integer) TO service_role;

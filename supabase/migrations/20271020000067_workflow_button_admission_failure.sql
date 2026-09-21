-- A failed preflight has not sent anything. Resolve its failure branch without
-- manufacturing an instance/recipient reference or cancelling an earlier reservation.
CREATE FUNCTION public.fail_workflow_button_admission(p_execution_id uuid,p_organization_id uuid,p_node_id text,p_visit integer,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.workflow_executions; target text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('instance_unavailable','recipient_unavailable','reservation_unavailable') OR p_visit IS NULL OR p_visit<1 THEN RAISE EXCEPTION 'question_admission_reason_invalid'; END IF;
  SELECT * INTO e FROM public.workflow_executions WHERE id=p_execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR e.status NOT IN ('running','processing') OR e.current_node_id IS DISTINCT FROM p_node_id OR e.question_buttons_definition IS NULL THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.workflow_button_questions q WHERE q.execution_id=e.id AND q.organization_id=p_organization_id AND q.node_id=p_node_id
    AND (q.visit=p_visit OR q.state IN ('queued','sending','waiting','uncertain'))) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.workflow_execution_steps s WHERE s.execution_id=e.id AND s.node_id=p_node_id AND s.node_type='question_buttons'
    AND s.output_data->>'admission_visit'=p_visit::text) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'nodes') n WHERE n->>'id'=p_node_id AND n->>'type'='question_buttons') THEN RAISE EXCEPTION 'question_definition_unavailable'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed WHERE ed->>'source'=p_node_id AND ed->>'sourceHandle'='send_failure')<>1 THEN RAISE EXCEPTION 'question_destination_unavailable'; END IF;
  SELECT ed->>'target' INTO target FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed WHERE ed->>'source'=p_node_id AND ed->>'sourceHandle'='send_failure';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'nodes') n WHERE n->>'id'=target) THEN RAISE EXCEPTION 'question_destination_unavailable'; END IF;
  INSERT INTO public.workflow_execution_steps(execution_id,node_id,node_type,node_label,status,output_data)
    VALUES(e.id,p_node_id,'question_buttons','Pergunta com botões','success',jsonb_build_object('admission_visit',p_visit,'branch','send_failure','reason',p_reason));
  UPDATE public.workflow_executions SET status='running',current_node_id=target,next_run_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=e.id AND organization_id=p_organization_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fail_workflow_button_admission(uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_workflow_button_admission(uuid,uuid,text,integer,text) TO service_role;

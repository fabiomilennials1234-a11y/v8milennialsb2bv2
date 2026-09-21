-- Operational projection only. Never exposes phone, full message body, asset paths or provider credentials.
CREATE FUNCTION public.get_workflow_button_history(p_execution_id uuid)
RETURNS TABLE(id uuid,node_id text,state text,selected_handle text,selected_label text,failure_reason text,send_check_count integer,deadline_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.workflow_executions; admin_access boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.workflow_executions WHERE workflow_executions.id=p_execution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  admin_access:=coalesce(public.can_administer_guided_workflow(e.organization_id),false);
  IF public.is_master_user() AND NOT admin_access THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF NOT admin_access AND NOT coalesce(
    e.organization_id IN (SELECT public.get_my_organization_ids())
    AND public.has_feature_permission('workflows.view',e.organization_id)
    ,false) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workflow_button_questions q WHERE q.execution_id=e.id AND q.organization_id=e.organization_id)
    AND NOT (admin_access AND EXISTS(SELECT 1 FROM public.workflow_execution_steps s WHERE s.execution_id=e.id AND s.node_type='question_buttons' AND s.output_data ? 'admission_visit')) THEN RETURN; END IF;
  IF NOT admin_access AND NOT coalesce(public.has_feature_permission('whatsapp.view',e.organization_id)
    AND public.can_link_or_read_lead(e.lead_id,e.organization_id)
    AND public.can_see_chat_lead(e.organization_id,e.lead_id),false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT h.id,h.node_id,h.state,h.selected_handle,h.selected_label,h.failure_reason,h.send_check_count,h.deadline_at
    FROM (
      SELECT q.id,q.node_id,q.state,q.selected_handle,
        (SELECT b->>'label' FROM jsonb_array_elements(q.options) b WHERE b->>'id'=q.selected_option LIMIT 1) AS selected_label,
        q.failure_reason,q.send_check_count,q.deadline_at,q.created_at AS happened_at
      FROM public.workflow_button_questions q
      WHERE q.execution_id=e.id AND q.organization_id=e.organization_id
        AND (admin_access OR q.instance_id=ANY(public.whatsapp_readable_instance_ids(e.organization_id,ARRAY[q.instance_id])))
      UNION ALL
      -- No verified instance exists for admission failures. Only administrators may inspect them.
      SELECT s.id,s.node_id,'resolved'::text,'send_failure'::text,NULL::text,s.output_data->>'reason',0,NULL::timestamptz,s.executed_at
      FROM public.workflow_execution_steps s
      WHERE admin_access AND s.execution_id=e.id AND s.node_type='question_buttons'
        AND s.output_data ? 'admission_visit' AND s.output_data->>'branch'='send_failure'
        AND s.output_data->>'reason' IN ('instance_unavailable','recipient_unavailable','reservation_unavailable')
    ) h ORDER BY h.happened_at,h.id LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.get_workflow_button_history(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_workflow_button_history(uuid) TO authenticated;

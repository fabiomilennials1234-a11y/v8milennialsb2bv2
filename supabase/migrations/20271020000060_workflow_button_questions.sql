-- Controlled text-question slice. No cron, sender, legacy wait/claim replacement or rollout enablement.
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS question_buttons_definition jsonb;

CREATE FUNCTION public.guard_workflow_button_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.question_buttons_definition IS NOT NULL THEN RAISE EXCEPTION 'question_snapshot_server_owned'; END IF;
  ELSIF NEW.question_buttons_definition IS DISTINCT FROM OLD.question_buttons_definition THEN
    IF OLD.question_buttons_definition IS NOT NULL OR current_user NOT IN ('postgres','service_role','supabase_admin') THEN
      RAISE EXCEPTION 'question_snapshot_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_workflow_button_snapshot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_workflow_button_snapshot BEFORE INSERT OR UPDATE OF question_buttons_definition ON public.workflow_executions
FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_button_snapshot();

CREATE TABLE public.workflow_button_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  node_id text NOT NULL, visit integer NOT NULL CHECK (visit > 0),
  phone text NOT NULL, options jsonb NOT NULL, destinations jsonb NOT NULL,
  timeout_hours numeric NOT NULL CHECK (timeout_hours > 0),
  state text NOT NULL CHECK (state IN ('sending', 'waiting', 'uncertain', 'resolved', 'cancelled')),
  outbound_message_id text, accepted_at timestamptz, deadline_at timestamptz,
  selected_option text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (execution_id, node_id, visit)
);
CREATE INDEX workflow_button_questions_org ON public.workflow_button_questions(organization_id, execution_id);
CREATE UNIQUE INDEX workflow_button_questions_active_conversation
  ON public.workflow_button_questions(organization_id, instance_id, lead_id)
  WHERE state IN ('sending', 'waiting', 'uncertain');
ALTER TABLE public.workflow_button_questions ENABLE ROW LEVEL SECURITY;
-- Execution state is server-owned. No authenticated/anon mutation or observation surface yet.
REVOKE ALL ON public.workflow_button_questions FROM anon, authenticated;
GRANT ALL ON public.workflow_button_questions TO service_role;

CREATE TABLE public.workflow_button_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.workflow_button_questions(id) ON DELETE CASCADE,
  message_row_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  option_id text NOT NULL, quoted text NOT NULL, received_at timestamptz NOT NULL,
  UNIQUE (question_id, message_row_id)
);
CREATE INDEX workflow_button_replies_org ON public.workflow_button_replies(organization_id, question_id, received_at);
ALTER TABLE public.workflow_button_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_button_replies FROM anon, authenticated;
GRANT ALL ON public.workflow_button_replies TO service_role;

CREATE FUNCTION public.freeze_workflow_button_definition(p_execution_id uuid, p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.workflow_executions; d jsonb;
BEGIN
  SELECT * INTO e FROM public.workflow_executions WHERE id=p_execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'question_execution_unavailable'; END IF;
  IF e.question_buttons_definition IS NOT NULL THEN RETURN e.question_buttons_definition; END IF;
  IF NOT coalesce((SELECT feature_flags->'workflow_question_buttons' = 'true'::jsonb
    FROM public.organizations WHERE id=p_organization_id),false) THEN
    RAISE EXCEPTION 'question_feature_disabled';
  END IF;
  IF e.guided_version_id IS NOT NULL THEN
    SELECT definition INTO d FROM public.workflow_guided_versions
      WHERE id=e.guided_version_id AND workflow_id=e.workflow_id AND organization_id=p_organization_id;
  ELSE
    SELECT definition INTO d FROM public.workflows WHERE id=e.workflow_id AND organization_id=p_organization_id;
  END IF;
  IF d IS NULL THEN RAISE EXCEPTION 'question_definition_unavailable'; END IF;
  UPDATE public.workflow_executions SET question_buttons_definition=d WHERE id=e.id AND organization_id=p_organization_id;
  RETURN d;
END $$;

CREATE FUNCTION public.prepare_workflow_button_question(
  p_execution_id uuid, p_organization_id uuid, p_node_id text, p_visit integer, p_instance_id uuid, p_phone text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.workflow_executions; q public.workflow_button_questions; n jsonb; dest jsonb; actual_phone text;
BEGIN
  SELECT * INTO e FROM public.workflow_executions WHERE id=p_execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR e.lead_id IS NULL OR e.question_buttons_definition IS NULL THEN RAISE EXCEPTION 'question_execution_unavailable'; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE execution_id=e.id AND node_id=p_node_id
    AND (visit=p_visit OR state IN ('sending','waiting','uncertain')) ORDER BY visit DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('id',q.id,'send',false); END IF;
  IF e.status NOT IN ('running','processing') OR e.current_node_id IS DISTINCT FROM p_node_id THEN RAISE EXCEPTION 'question_execution_not_running'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances WHERE id=p_instance_id AND organization_id=p_organization_id AND status IN ('open','connected')) THEN RAISE EXCEPTION 'question_instance_unavailable'; END IF;
  SELECT regexp_replace(phone,'[^0-9]','','g') INTO actual_phone FROM public.leads WHERE id=e.lead_id AND organization_id=p_organization_id;
  IF actual_phone NOT LIKE '55%' THEN actual_phone := '55'||actual_phone; END IF;
  IF actual_phone IS NULL OR actual_phone<>p_phone THEN RAISE EXCEPTION 'question_recipient_unavailable'; END IF;
  SELECT value->'data' INTO n FROM jsonb_array_elements(e.question_buttons_definition->'nodes') WHERE value->>'id'=p_node_id AND value->>'type'='question_buttons';
  IF n IS NULL OR jsonb_typeof(n->'buttons') <> 'array' OR jsonb_array_length(n->'buttons') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'question_invalid_configuration'; END IF;
  SELECT jsonb_object_agg(value->>'sourceHandle',value->>'target') INTO dest
    FROM jsonb_array_elements(e.question_buttons_definition->'edges') WHERE value->>'source'=p_node_id;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed
    WHERE ed->>'source'=p_node_id GROUP BY ed->>'sourceHandle' HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed
      WHERE ed->>'source'=p_node_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'nodes') nd WHERE nd->>'id'=ed->>'target'))
    THEN RAISE EXCEPTION 'question_invalid_configuration'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(n->'buttons') b
    WHERE b->>'id' !~ '^[A-Za-z0-9_-]+$' OR nullif(b->>'label','') IS NULL OR b->>'label' ~ '[|\r\n]'
      OR (SELECT count(*) FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed
        WHERE ed->>'source'=p_node_id AND ed->>'sourceHandle'='button:'||(b->>'id')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'nodes') nd WHERE nd->>'id'=ed->>'target'))<>1)
    THEN RAISE EXCEPTION 'question_invalid_configuration'; END IF;
  INSERT INTO public.workflow_button_questions(organization_id,execution_id,lead_id,instance_id,node_id,visit,phone,options,destinations,timeout_hours,state)
    VALUES(p_organization_id,e.id,e.lead_id,p_instance_id,p_node_id,p_visit,p_phone,n->'buttons',dest,coalesce((n->>'timeoutHours')::numeric,24),'sending') RETURNING * INTO q;
  UPDATE public.workflow_executions SET status='paused', next_run_at=NULL, updated_at=clock_timestamp(),
    guided_condition_retry_node_id=NULL,guided_condition_retry_count=0,guided_condition_retry_error=NULL WHERE id=e.id AND organization_id=p_organization_id;
  RETURN jsonb_build_object('id',q.id,'send',true);
END $$;

-- Internal service-only arbiter; acceptance and inbox use the same row lock/order.
CREATE FUNCTION public.resolve_workflow_button_question(p_id uuid,p_organization_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q public.workflow_button_questions; r record; target text; e public.workflow_executions;
BEGIN
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO e FROM public.workflow_executions WHERE id=q.execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR e.status<>'paused' OR e.current_node_id<>q.node_id THEN RETURN false; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR q.state<>'waiting' THEN RETURN false; END IF;
  -- A receipt already persisted first wins even when B's worker reaches this RPC first.
  SELECT split_part(m.raw_payload->>'buttonOrListid',':',2) AS option_id INTO r
    FROM public.whatsapp_messages m WHERE m.organization_id=p_organization_id AND m.instance_id=q.instance_id
    AND m.direction='incoming' AND NOT m.is_group AND (m.lead_id IS NULL OR m.lead_id=q.lead_id)
    AND regexp_replace(m.phone_number,'[^0-9]','','g')=q.phone
    AND coalesce(m.raw_payload->>'fromMe','false')='false'
    AND m.raw_payload->>'quoted'=q.outbound_message_id AND m.created_at>=q.created_at AND m.created_at<q.deadline_at
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.options) o
      WHERE m.raw_payload->>'buttonOrListid'=q.id::text||':'||(o->>'id'))
    ORDER BY m.created_at,m.id LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  target:=q.destinations->>('button:'||r.option_id);
  IF target IS NULL THEN RAISE EXCEPTION 'question_destination_unavailable'; END IF;
  UPDATE public.workflow_button_questions SET state='resolved',selected_option=r.option_id,resolved_at=clock_timestamp() WHERE id=q.id;
  INSERT INTO public.workflow_execution_steps(execution_id,node_id,node_type,node_label,status,output_data)
    VALUES(e.id,q.node_id,'question_buttons','Pergunta com botões','success',jsonb_build_object('question_id',q.id,'branch','button:'||r.option_id));
  UPDATE public.workflow_executions SET status='running', current_node_id=target,next_run_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=e.id AND organization_id=p_organization_id;
  RETURN true;
END $$;

CREATE FUNCTION public.accept_workflow_button_question(p_id uuid,p_organization_id uuid,p_message_id text,p_accepted_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q public.workflow_button_questions;
BEGIN
  IF nullif(p_message_id,'') IS NULL OR p_accepted_at IS NULL THEN RETURN false; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.workflow_executions WHERE id=q.execution_id AND organization_id=p_organization_id FOR UPDATE;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF q.state IN ('waiting','resolved') THEN RETURN q.outbound_message_id=p_message_id; END IF;
  IF q.state NOT IN ('sending','uncertain') THEN RETURN false; END IF;
  UPDATE public.workflow_button_questions SET state='waiting',outbound_message_id=p_message_id,accepted_at=p_accepted_at,
    deadline_at=p_accepted_at + (q.timeout_hours * interval '1 hour') WHERE id=q.id;
  PERFORM public.resolve_workflow_button_question(q.id,p_organization_id);
  RETURN true;
END $$;

-- Only persisted, organization-authorized inbound messages can supply a choice.
-- Raw buttonOrListid is authoritative: image replies normalize to text on Uazapi.
CREATE FUNCTION public.receive_workflow_button_reply(p_message_row_id uuid,p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE m public.whatsapp_messages; q public.workflow_button_questions; option_key text; occurrence text; option_id text;
BEGIN
  SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_row_id AND organization_id=p_organization_id;
  IF NOT FOUND OR m.direction<>'incoming' OR m.is_group OR coalesce(m.raw_payload->>'fromMe','false')<>'false' THEN RETURN jsonb_build_object('recognized',false,'resolved',false); END IF;
  option_key:=m.raw_payload->>'buttonOrListid'; occurrence:=split_part(option_key,':',1); option_id:=split_part(option_key,':',2);
  IF occurrence IS NULL OR occurrence !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR option_id !~ '^[A-Za-z0-9_-]+$' OR option_key<>occurrence||':'||option_id
    OR nullif(m.raw_payload->>'quoted','') IS NULL THEN RETURN jsonb_build_object('recognized',false,'resolved',false); END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=occurrence::uuid AND organization_id=p_organization_id
    AND instance_id=m.instance_id AND phone=regexp_replace(m.phone_number,'[^0-9]','','g');
  IF NOT FOUND OR (m.lead_id IS NOT NULL AND m.lead_id<>q.lead_id) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.options) o WHERE o->>'id'=option_id) THEN RETURN jsonb_build_object('recognized',false,'resolved',false); END IF;
  PERFORM 1 FROM public.workflow_executions WHERE id=q.execution_id AND organization_id=p_organization_id FOR UPDATE;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=q.id AND organization_id=p_organization_id FOR UPDATE;
  IF q.state IN ('resolved','cancelled') THEN RETURN jsonb_build_object('recognized',true,'resolved',false); END IF;
  INSERT INTO public.workflow_button_replies(organization_id,question_id,message_row_id,option_id,quoted,received_at)
    VALUES(p_organization_id,q.id,m.id,option_id,m.raw_payload->>'quoted',m.created_at)
    ON CONFLICT(question_id,message_row_id) DO NOTHING;
  RETURN jsonb_build_object('recognized',true,'resolved',public.resolve_workflow_button_question(q.id,p_organization_id));
END $$;

-- Cancelling/completing an execution must release only its own active question.
CREATE FUNCTION public.cancel_workflow_button_questions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.question_buttons_definition IS NOT NULL AND NEW.status IN ('cancelled','completed','failed','loop_limit_reached') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.workflow_button_questions SET state='cancelled'
      WHERE execution_id=NEW.id AND organization_id=NEW.organization_id AND state IN ('sending','waiting','uncertain');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cancel_workflow_button_questions() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cancel_workflow_button_questions AFTER UPDATE OF status ON public.workflow_executions
FOR EACH ROW EXECUTE FUNCTION public.cancel_workflow_button_questions();

REVOKE ALL ON FUNCTION public.freeze_workflow_button_definition(uuid,uuid),
  public.prepare_workflow_button_question(uuid,uuid,text,integer,uuid,text),
  public.resolve_workflow_button_question(uuid,uuid), public.accept_workflow_button_question(uuid,uuid,text,timestamptz),
  public.receive_workflow_button_reply(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_workflow_button_definition(uuid,uuid),
  public.prepare_workflow_button_question(uuid,uuid,text,integer,uuid,text),
  public.resolve_workflow_button_question(uuid,uuid), public.accept_workflow_button_question(uuid,uuid,text,timestamptz),
  public.receive_workflow_button_reply(uuid,uuid) TO service_role;

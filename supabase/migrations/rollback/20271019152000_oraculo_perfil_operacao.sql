DROP FUNCTION IF EXISTS public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text);
DROP VIEW IF EXISTS public.oraculo_profile_adoption_60d;
DROP FUNCTION IF EXISTS public.oraculo_adjust_member_profile(uuid,uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.oraculo_edit_own_profile(uuid,uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.oraculo_record_profile_response(uuid,uuid,uuid,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.oraculo_get_profile_context(uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_get_operation_profile(uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_meeting_profile_metrics(uuid,uuid,integer);
DROP TABLE IF EXISTS public.oraculo_operation_profile_entries;
DROP TABLE IF EXISTS public.oraculo_interview_questions;

-- Restaura a gravação atômica da SCRUM-598, incluindo propostas de ação.
CREATE FUNCTION public.oraculo_save_turn(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_last_message_at timestamptz,
  p_question text,
  p_result jsonb,
  p_summary text
)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conversation public.oraculo_conversations%ROWTYPE;
  v_now timestamptz;
  v_assistant_turn_id uuid;
BEGIN
  SELECT * INTO v_conversation FROM public.oraculo_conversations
  WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa indisponível' USING ERRCODE = '42501'; END IF;
  IF v_conversation.last_message_at IS DISTINCT FROM p_expected_last_message_at THEN
    RAISE EXCEPTION 'A conversa recebeu outro turno; recarregue antes de continuar' USING ERRCODE = 'PT409';
  END IF;

  v_now := greatest(clock_timestamp(), v_conversation.last_message_at + interval '2 microseconds');
  INSERT INTO public.oraculo_turns (
    conversation_id, organization_id, user_id, role, content, tools_used, rejected_tools,
    hit_tool_ceiling, model, input_tokens, output_tokens, latency_ms, created_at
  ) VALUES (
    p_conversation_id, p_organization_id, p_user_id, 'user', p_question,
    '{}', '{}', false, NULL, NULL, NULL, NULL, v_now
  );
  INSERT INTO public.oraculo_turns (
    conversation_id, organization_id, user_id, role, content, tools_used, rejected_tools,
    hit_tool_ceiling, model, input_tokens, output_tokens, latency_ms, created_at
  ) VALUES (
    p_conversation_id, p_organization_id, p_user_id, 'assistant', p_result->>'text',
    ARRAY(SELECT jsonb_array_elements_text(p_result->'toolsUsed')),
    ARRAY(SELECT jsonb_array_elements_text(p_result->'rejectedToolCalls')),
    (p_result->>'hitToolCeiling')::boolean,
    p_result->'telemetry'->>'model',
    (p_result->'telemetry'->>'inputTokens')::integer,
    (p_result->'telemetry'->>'outputTokens')::integer,
    (p_result->'telemetry'->>'latencyMs')::integer,
    v_now + interval '1 microsecond'
  ) RETURNING id INTO v_assistant_turn_id;

  INSERT INTO public.oraculo_action_proposals (
    id, organization_id, conversation_id, turn_id, proposed_by,
    scope_team_member_id, action_type, criterion, parameters, preview_count
  )
  SELECT
    (proposal->>'id')::uuid, p_organization_id, p_conversation_id,
    v_assistant_turn_id, p_user_id,
      v_conversation.team_member_id,
    proposal->>'acao', proposal->'criterio', proposal->'parametros',
    greatest(0, coalesce((proposal->>'previsao')::integer, 0))
  FROM jsonb_array_elements(coalesce(p_result->'proposals', '[]'::jsonb)) proposal
  WHERE proposal->>'kind' = 'oraculo_action_proposal'
    AND proposal->>'status' = 'pendente';

  UPDATE public.oraculo_conversations SET
    summary = p_summary,
    title = CASE WHEN title IS NULL THEN left(p_question, 80) ELSE title END,
    last_message_at = v_now + interval '1 microsecond',
    updated_at = v_now
  WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text)
  TO service_role;

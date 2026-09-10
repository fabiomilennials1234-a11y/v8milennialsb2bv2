-- Rollback SCRUM-600. Preserva SCRUM-599 e restaura seu contrato de turno.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-feedback-alerts') THEN
      PERFORM cron.unschedule('oraculo-feedback-alerts');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-feedback-weekly') THEN
      PERFORM cron.unschedule('oraculo-feedback-weekly');
    END IF;
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.invoke_oraculo_feedback_worker(text);
DROP FUNCTION IF EXISTS public.oraculo_finish_weekly_feedback_digest(uuid,boolean,text);
DROP FUNCTION IF EXISTS public.oraculo_prepare_weekly_feedback_digest(timestamptz);
DROP FUNCTION IF EXISTS public.oraculo_finish_feedback_alert(uuid,boolean,text);
DROP FUNCTION IF EXISTS public.oraculo_claim_feedback_alert(uuid);
DROP FUNCTION IF EXISTS public.oraculo_feedback_case(uuid);
DROP FUNCTION IF EXISTS public.oraculo_feedback_cases(integer);
DROP FUNCTION IF EXISTS public.oraculo_record_product_signal(uuid,uuid,text,uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_feedback_state(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_submit_feedback(uuid,uuid,text,text,text,text,uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text);
DROP FUNCTION IF EXISTS public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text,jsonb);

DROP TABLE IF EXISTS public.oraculo_feedback_alerts;
DROP TABLE IF EXISTS public.oraculo_feedback_digest_deliveries;
DROP TABLE IF EXISTS public.oraculo_product_signals;
DROP TABLE IF EXISTS public.oraculo_feedback;
DROP TABLE IF EXISTS public.oraculo_tool_traces;

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
  v_question_count integer;
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
    v_assistant_turn_id, p_user_id, v_conversation.team_member_id,
    proposal->>'acao', proposal->'criterio', proposal->'parametros',
    greatest(0, coalesce((proposal->>'previsao')::integer, 0))
  FROM jsonb_array_elements(coalesce(p_result->'proposals', '[]'::jsonb)) proposal
  WHERE proposal->>'kind' = 'oraculo_action_proposal' AND proposal->>'status' = 'pendente';

  SELECT count(*) INTO v_question_count
  FROM public.oraculo_interview_questions WHERE conversation_id = p_conversation_id;
  INSERT INTO public.oraculo_interview_questions (
    id, organization_id, conversation_id, turn_id, asked_user_id,
    subject_team_member_id, question_key, prompt, measured_context
  )
  SELECT
    (question.value->>'id')::uuid, p_organization_id, p_conversation_id,
    v_assistant_turn_id, p_user_id, v_conversation.team_member_id,
    question.value->>'question_key', question.value->>'prompt',
    question.value->'measured_context'
  FROM jsonb_array_elements(coalesce(p_result->'profileQuestions', '[]'::jsonb))
    WITH ORDINALITY AS question(value, ordinal)
  WHERE v_conversation.team_member_id IS NOT NULL
    AND question.ordinal <= greatest(0, 3 - v_question_count)
  ON CONFLICT (conversation_id, question_key) DO NOTHING;

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

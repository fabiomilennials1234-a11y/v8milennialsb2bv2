-- Conflito de versão é resposta HTTP definitiva, não falha transitória de serialização.
-- Ensaio real: 40001 não completou em 20 s; PT409 devolveu conflito em 142 ms.
-- SCRUM-594: pergunta, resposta e memória são uma única confirmação.
-- RPC exclusiva do servidor; identidade e organização vêm do ator autenticado.
CREATE OR REPLACE FUNCTION public.oraculo_save_turn(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_last_message_at timestamptz,
  p_question text,
  p_result jsonb,
  p_summary text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conversation public.oraculo_conversations%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_conversation FROM public.oraculo_conversations
    WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa indisponível' USING ERRCODE = '42501';
  END IF;
  IF v_conversation.last_message_at IS DISTINCT FROM p_expected_last_message_at THEN
    RAISE EXCEPTION 'A conversa recebeu outro turno; recarregue antes de continuar' USING ERRCODE = 'PT409';
  END IF;

  v_now := greatest(clock_timestamp(), v_conversation.last_message_at + interval '2 microseconds');
  INSERT INTO public.oraculo_turns (
    conversation_id, organization_id, user_id, role, content, tools_used, rejected_tools,
    hit_tool_ceiling, model, input_tokens, output_tokens, latency_ms, created_at
  ) VALUES
    (p_conversation_id, p_organization_id, p_user_id, 'user', p_question,
     '{}', '{}', false, NULL, NULL, NULL, NULL, v_now),
    (p_conversation_id, p_organization_id, p_user_id, 'assistant', p_result->>'text',
     ARRAY(SELECT jsonb_array_elements_text(p_result->'toolsUsed')),
     ARRAY(SELECT jsonb_array_elements_text(p_result->'rejectedToolCalls')),
     (p_result->>'hitToolCeiling')::boolean,
     p_result->'telemetry'->>'model',
     (p_result->'telemetry'->>'inputTokens')::integer,
     (p_result->'telemetry'->>'outputTokens')::integer,
     (p_result->'telemetry'->>'latencyMs')::integer,
     v_now + interval '1 microsecond');

  UPDATE public.oraculo_conversations SET
    summary = p_summary,
    title = CASE WHEN title IS NULL THEN left(p_question, 80) ELSE title END,
    last_message_at = v_now + interval '1 microsecond',
    updated_at = v_now
    WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.oraculo_save_turn(uuid, uuid, uuid, timestamptz, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_save_turn(uuid, uuid, uuid, timestamptz, text, jsonb, text)
  TO service_role;

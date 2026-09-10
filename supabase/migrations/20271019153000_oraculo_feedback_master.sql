-- SCRUM-600 · Feedback reproduzível e canal operacional do Master.
-- O rastro bruto fica fora das tabelas legíveis pelo navegador. A avaliação
-- recebe uma fotografia desse rastro; somente a edge validada e o Master leem.

CREATE TABLE public.oraculo_tool_traces (
  assistant_turn_id uuid PRIMARY KEY REFERENCES public.oraculo_turns(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trace jsonb NOT NULL CHECK (jsonb_typeof(trace) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oraculo_tool_traces_conversation_idx
  ON public.oraculo_tool_traces (conversation_id, created_at);

CREATE TABLE public.oraculo_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  assistant_turn_id uuid REFERENCES public.oraculo_turns(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('response', 'conversation')),
  rating text NOT NULL CHECK (rating IN ('positive', 'negative')),
  reason text CHECK (reason IN (
    'wrong_number', 'misunderstood', 'too_obvious', 'not_actionable', 'invented'
  )),
  comment text CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 2000),
  trace_snapshot jsonb NOT NULL CHECK (jsonb_typeof(trace_snapshot) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((rating = 'negative' AND reason IS NOT NULL) OR (rating = 'positive' AND reason IS NULL)),
  CHECK ((target_type = 'response' AND assistant_turn_id IS NOT NULL)
      OR (target_type = 'conversation' AND assistant_turn_id IS NULL))
);

CREATE UNIQUE INDEX oraculo_feedback_response_once_idx
  ON public.oraculo_feedback (submitted_by, assistant_turn_id)
  WHERE target_type = 'response';
CREATE UNIQUE INDEX oraculo_feedback_conversation_once_idx
  ON public.oraculo_feedback (submitted_by, conversation_id)
  WHERE target_type = 'conversation';
CREATE INDEX oraculo_feedback_master_queue_idx
  ON public.oraculo_feedback (updated_at DESC);

CREATE TABLE public.oraculo_feedback_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL UNIQUE REFERENCES public.oraculo_feedback(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oraculo_feedback_alerts_pending_idx
  ON public.oraculo_feedback_alerts (next_attempt_at)
  WHERE status = 'pending';

CREATE TABLE public.oraculo_feedback_digest_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start, period_end),
  CHECK (period_end = period_start + 6)
);

CREATE TABLE public.oraculo_product_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES public.oraculo_action_proposals(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'briefing_opened', 'proposal_clicked', 'conversation_continued'
  )),
  dedupe_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, event_type, dedupe_key)
);

CREATE INDEX oraculo_product_signals_analysis_idx
  ON public.oraculo_product_signals (event_type, occurred_at DESC);

ALTER TABLE public.oraculo_tool_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_feedback_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_feedback_digest_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_product_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.oraculo_tool_traces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_feedback FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_feedback_alerts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_feedback_digest_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_product_signals FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.oraculo_submit_feedback(
  p_organization_id uuid,
  p_user_id uuid,
  p_target_type text,
  p_rating text,
  p_reason text,
  p_comment text,
  p_assistant_turn_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_feedback_id uuid;
  v_alert_id uuid;
  v_trace jsonb;
BEGIN
  IF p_target_type NOT IN ('response', 'conversation')
     OR p_rating NOT IN ('positive', 'negative') THEN
    RAISE EXCEPTION 'avaliação inválida' USING ERRCODE = '22023';
  END IF;
  IF (p_rating = 'negative' AND (p_reason IS NULL OR p_reason NOT IN (
      'wrong_number', 'misunderstood', 'too_obvious', 'not_actionable', 'invented'
    ))) OR (p_rating = 'positive' AND p_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'motivo inválido' USING ERRCODE = '22023';
  END IF;
  IF p_comment IS NOT NULL AND char_length(btrim(p_comment)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'comentário inválido' USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'response' THEN
    SELECT conversation_id INTO v_conversation_id
    FROM public.oraculo_turns
    WHERE id = p_assistant_turn_id
      AND organization_id = p_organization_id
      AND user_id = p_user_id
      AND role = 'assistant';
    IF NOT FOUND THEN RAISE EXCEPTION 'resposta indisponível' USING ERRCODE = '42501'; END IF;
  ELSE
    SELECT id INTO v_conversation_id
    FROM public.oraculo_conversations
    WHERE id = p_conversation_id
      AND organization_id = p_organization_id
      AND user_id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'conversa indisponível' USING ERRCODE = '42501'; END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'turn_id', trace.assistant_turn_id,
    'trace', trace.trace
  ) ORDER BY trace.created_at), '[]'::jsonb)
  INTO v_trace
  FROM public.oraculo_tool_traces trace
  WHERE trace.conversation_id = v_conversation_id
    AND trace.organization_id = p_organization_id
    AND trace.user_id = p_user_id
    AND (p_target_type = 'conversation' OR trace.assistant_turn_id = p_assistant_turn_id);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::text || ':' || p_target_type || ':' ||
    coalesce(p_assistant_turn_id::text, v_conversation_id::text), 0
  ));

  IF p_target_type = 'response' THEN
    SELECT id INTO v_feedback_id FROM public.oraculo_feedback
    WHERE submitted_by = p_user_id AND assistant_turn_id = p_assistant_turn_id
    FOR UPDATE;
  ELSE
    SELECT id INTO v_feedback_id FROM public.oraculo_feedback
    WHERE submitted_by = p_user_id AND conversation_id = v_conversation_id
      AND target_type = 'conversation'
    FOR UPDATE;
  END IF;

  IF v_feedback_id IS NULL THEN
    INSERT INTO public.oraculo_feedback (
      organization_id, conversation_id, assistant_turn_id, submitted_by,
      target_type, rating, reason, comment, trace_snapshot
    ) VALUES (
      p_organization_id, v_conversation_id,
      CASE WHEN p_target_type = 'response' THEN p_assistant_turn_id ELSE NULL END,
      p_user_id, p_target_type, p_rating, p_reason,
      nullif(btrim(coalesce(p_comment, '')), ''), v_trace
    ) RETURNING id INTO v_feedback_id;
  ELSE
    UPDATE public.oraculo_feedback SET
      rating = p_rating,
      reason = p_reason,
      comment = nullif(btrim(coalesce(p_comment, '')), ''),
      trace_snapshot = v_trace,
      updated_at = now()
    WHERE id = v_feedback_id;
  END IF;

  IF p_rating = 'negative' AND p_reason = 'invented' THEN
    INSERT INTO public.oraculo_feedback_alerts (feedback_id)
    VALUES (v_feedback_id)
    ON CONFLICT (feedback_id) DO NOTHING
    RETURNING id INTO v_alert_id;
  END IF;

  RETURN jsonb_build_object('id', v_feedback_id, 'alert_id', v_alert_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_feedback_state(
  p_organization_id uuid,
  p_user_id uuid,
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.oraculo_conversations
    WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'conversa indisponível' USING ERRCODE = '42501'; END IF;

  SELECT jsonb_build_object(
    'conversation', (
      SELECT jsonb_build_object('id', id, 'rating', rating, 'reason', reason, 'comment', comment)
      FROM public.oraculo_feedback
      WHERE conversation_id = p_conversation_id AND submitted_by = p_user_id
        AND target_type = 'conversation'
    ),
    'responses', coalesce((
      SELECT jsonb_object_agg(assistant_turn_id::text, jsonb_build_object(
        'id', id, 'rating', rating, 'reason', reason, 'comment', comment
      ))
      FROM public.oraculo_feedback
      WHERE conversation_id = p_conversation_id AND submitted_by = p_user_id
        AND target_type = 'response'
    ), '{}'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_record_product_signal(
  p_organization_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_conversation_id uuid DEFAULT NULL,
  p_proposal_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_key text;
BEGIN
  IF p_event_type = 'briefing_opened' THEN
    v_key := (now() AT TIME ZONE 'America/Sao_Paulo')::date::text;
  ELSIF p_event_type = 'proposal_clicked' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.oraculo_action_proposals
      WHERE id = p_proposal_id AND organization_id = p_organization_id AND proposed_by = p_user_id
    ) THEN RAISE EXCEPTION 'proposta indisponível' USING ERRCODE = '42501'; END IF;
    v_key := p_proposal_id::text;
  ELSE
    RAISE EXCEPTION 'sinal inválido' USING ERRCODE = '22023';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.oraculo_conversations
    WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'conversa indisponível' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.oraculo_product_signals (
    organization_id, user_id, conversation_id, proposal_id, event_type, dedupe_key
  ) VALUES (
    p_organization_id, p_user_id, p_conversation_id, p_proposal_id, p_event_type, v_key
  ) ON CONFLICT (organization_id, user_id, event_type, dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_feedback_cases(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(result) ORDER BY result.updated_at DESC), '[]'::jsonb)
  FROM (
    SELECT f.id, f.organization_id, o.name AS organization_name,
      f.target_type, f.rating, f.reason, f.comment,
      f.conversation_id, f.assistant_turn_id,
      c.title AS conversation_title,
      jsonb_array_length(f.trace_snapshot) AS traced_responses,
      f.created_at, f.updated_at
    FROM public.oraculo_feedback f
    JOIN public.organizations o ON o.id = f.organization_id
    JOIN public.oraculo_conversations c ON c.id = f.conversation_id
    ORDER BY f.updated_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 100))
  ) result;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_feedback_case(p_feedback_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', f.id,
    'organization_id', f.organization_id,
    'organization_name', o.name,
    'target_type', f.target_type,
    'rating', f.rating,
    'reason', f.reason,
    'comment', f.comment,
    'conversation_id', f.conversation_id,
    'assistant_turn_id', f.assistant_turn_id,
    'conversation_title', c.title,
    'question', CASE WHEN f.assistant_turn_id IS NULL THEN NULL ELSE (
      SELECT t.content FROM public.oraculo_turns t
      WHERE t.conversation_id = f.conversation_id AND t.role = 'user'
        AND t.created_at < answer.created_at
      ORDER BY t.created_at DESC LIMIT 1
    ) END,
    'answer', answer.content,
    'tools_used', answer.tools_used,
    'trace', f.trace_snapshot,
    'created_at', f.created_at,
    'updated_at', f.updated_at
  )
  FROM public.oraculo_feedback f
  JOIN public.organizations o ON o.id = f.organization_id
  JOIN public.oraculo_conversations c ON c.id = f.conversation_id
  LEFT JOIN public.oraculo_turns answer ON answer.id = f.assistant_turn_id
  WHERE f.id = p_feedback_id;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_claim_feedback_alert(p_alert_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_alert public.oraculo_feedback_alerts%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_alert FROM public.oraculo_feedback_alerts
  WHERE ((status = 'pending' AND next_attempt_at <= now())
      OR (status = 'processing' AND lease_until < now()))
    AND (p_alert_id IS NULL OR id = p_alert_id)
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.oraculo_feedback_alerts SET
    status = 'processing', attempts = attempts + 1,
    lease_until = now() + interval '2 minutes', updated_at = now()
  WHERE id = v_alert.id;

  SELECT jsonb_build_object(
    'alert_id', v_alert.id,
    'feedback_id', f.id,
    'organization_name', o.name,
    'comment', f.comment
  ) INTO v_result
  FROM public.oraculo_feedback f
  JOIN public.organizations o ON o.id = f.organization_id
  WHERE f.id = v_alert.feedback_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_finish_feedback_alert(
  p_alert_id uuid,
  p_sent boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.oraculo_feedback_alerts SET
    status = CASE WHEN p_sent THEN 'sent'
      WHEN attempts >= 8 THEN 'dead_letter' ELSE 'pending' END,
    next_attempt_at = CASE WHEN p_sent OR attempts >= 8 THEN next_attempt_at
      ELSE now() + make_interval(mins => least(60, (power(2, attempts))::integer)) END,
    lease_until = NULL,
    last_error = CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error, 'envio falhou'), 1000) END,
    sent_at = CASE WHEN p_sent THEN now() ELSE sent_at END,
    updated_at = now()
  WHERE id = p_alert_id AND status = 'processing';
$$;

CREATE OR REPLACE FUNCTION public.oraculo_prepare_weekly_feedback_digest(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_local_date date;
  v_start date;
  v_end date;
  v_delivery public.oraculo_feedback_digest_deliveries%ROWTYPE;
  v_summary jsonb;
  v_from timestamptz;
  v_until timestamptz;
BEGIN
  v_local_date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_end := v_local_date - extract(isodow FROM v_local_date)::integer;
  v_start := v_end - 6;
  v_from := v_start::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_until := (v_end + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';

  SELECT jsonb_build_object(
    'period_start', v_start,
    'period_end', v_end,
    'conversations', (SELECT count(DISTINCT conversation_id) FROM public.oraculo_turns
      WHERE role = 'user' AND created_at >= v_from AND created_at < v_until),
    'positive', count(*) FILTER (WHERE rating = 'positive'),
    'negative', count(*) FILTER (WHERE rating = 'negative'),
    'invented', count(*) FILTER (WHERE reason = 'invented')
  ) INTO v_summary
  FROM public.oraculo_feedback
  WHERE updated_at >= v_from AND updated_at < v_until;

  INSERT INTO public.oraculo_feedback_digest_deliveries (period_start, period_end, summary)
  VALUES (v_start, v_end, v_summary)
  ON CONFLICT (period_start, period_end) DO NOTHING;

  SELECT * INTO v_delivery FROM public.oraculo_feedback_digest_deliveries
  WHERE period_start = v_start AND period_end = v_end
    AND ((status = 'pending' AND next_attempt_at <= now())
      OR (status = 'processing' AND lease_until < now()))
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.oraculo_feedback_digest_deliveries SET
    status = 'processing', attempts = attempts + 1,
    lease_until = now() + interval '2 minutes', summary = v_summary, updated_at = now()
  WHERE id = v_delivery.id;
  RETURN v_summary || jsonb_build_object('delivery_id', v_delivery.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_finish_weekly_feedback_digest(
  p_delivery_id uuid,
  p_sent boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.oraculo_feedback_digest_deliveries SET
    status = CASE WHEN p_sent THEN 'sent' ELSE 'pending' END,
    next_attempt_at = CASE WHEN p_sent THEN next_attempt_at ELSE now() + interval '1 hour' END,
    lease_until = NULL,
    last_error = CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error, 'envio falhou'), 1000) END,
    sent_at = CASE WHEN p_sent THEN now() ELSE sent_at END,
    updated_at = now()
  WHERE id = p_delivery_id AND status = 'processing';
$$;

-- `p_result` continua sem o rastro. O novo argumento atravessa uma fronteira
-- explícita e cai somente em tabela service-only.
DROP FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text);
CREATE FUNCTION public.oraculo_save_turn(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_last_message_at timestamptz,
  p_question text,
  p_result jsonb,
  p_summary text,
  p_tool_trace jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conversation public.oraculo_conversations%ROWTYPE;
  v_now timestamptz;
  v_assistant_turn_id uuid;
  v_question_count integer;
  v_user_turns integer;
BEGIN
  SELECT * INTO v_conversation FROM public.oraculo_conversations
  WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa indisponível' USING ERRCODE = '42501'; END IF;
  IF v_conversation.last_message_at IS DISTINCT FROM p_expected_last_message_at THEN
    RAISE EXCEPTION 'A conversa recebeu outro turno; recarregue antes de continuar' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(coalesce(p_tool_trace, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'rastro inválido' USING ERRCODE = '22023';
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

  INSERT INTO public.oraculo_tool_traces (
    assistant_turn_id, organization_id, conversation_id, user_id, trace
  ) VALUES (
    v_assistant_turn_id, p_organization_id, p_conversation_id, p_user_id,
    coalesce(p_tool_trace, '[]'::jsonb)
  );

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

  SELECT count(*) INTO v_user_turns FROM public.oraculo_turns
  WHERE conversation_id = p_conversation_id AND role = 'user';
  IF v_user_turns > 1 THEN
    INSERT INTO public.oraculo_product_signals (
      organization_id, user_id, conversation_id, event_type, dedupe_key
    ) VALUES (
      p_organization_id, p_user_id, p_conversation_id,
      'conversation_continued', p_conversation_id::text
    ) ON CONFLICT (organization_id, user_id, event_type, dedupe_key) DO NOTHING;
  END IF;

  UPDATE public.oraculo_conversations SET
    summary = p_summary,
    title = CASE WHEN title IS NULL THEN left(p_question, 80) ELSE title END,
    last_message_at = v_now + interval '1 microsecond',
    updated_at = v_now
  WHERE id = p_conversation_id AND organization_id = p_organization_id AND user_id = p_user_id;
  RETURN v_assistant_turn_id;
END;
$$;

-- Compatibilidade com jobs/testes antigos durante a janela empilhada. O app
-- novo usa oito argumentos; callers antigos salvam rastro vazio com segurança.
CREATE FUNCTION public.oraculo_save_turn(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_last_message_at timestamptz,
  p_question text,
  p_result jsonb,
  p_summary text
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.oraculo_save_turn(
    p_conversation_id, p_organization_id, p_user_id,
    p_expected_last_message_at, p_question, p_result, p_summary, '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.oraculo_submit_feedback(uuid,uuid,text,text,text,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_feedback_state(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_record_product_signal(uuid,uuid,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_feedback_cases(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_feedback_case(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_claim_feedback_alert(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_finish_feedback_alert(uuid,boolean,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_prepare_weekly_feedback_digest(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_finish_weekly_feedback_digest(uuid,boolean,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.oraculo_submit_feedback(uuid,uuid,text,text,text,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_feedback_state(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_record_product_signal(uuid,uuid,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_feedback_cases(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_feedback_case(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_claim_feedback_alert(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_finish_feedback_alert(uuid,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_prepare_weekly_feedback_digest(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_finish_weekly_feedback_digest(uuid,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_oraculo_feedback_worker(p_mode text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_url text; v_secret text;
BEGIN
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/oraculo-feedback-worker')
    INTO v_url FROM public.cron_config
    WHERE value LIKE 'https://%/functions/v1/%'
    ORDER BY key LIMIT 1;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RAISE WARNING '[oraculo-feedback-worker] cron_config incompleto';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 30000
  );
EXCEPTION WHEN invalid_schema_name OR undefined_function OR undefined_table THEN RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_oraculo_feedback_worker(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_oraculo_feedback_worker(text) TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-feedback-alerts') THEN
      PERFORM cron.unschedule('oraculo-feedback-alerts');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-feedback-weekly') THEN
      PERFORM cron.unschedule('oraculo-feedback-weekly');
    END IF;
    PERFORM cron.schedule(
      'oraculo-feedback-alerts', '* * * * *',
      $$SELECT public.invoke_oraculo_feedback_worker('alerts')$$
    );
    -- 12:00 UTC = 09:00 America/Sao_Paulo. Roda diariamente para recuperar
    -- falha de segunda; a chave da semana garante um único envio bem-sucedido.
    PERFORM cron.schedule(
      'oraculo-feedback-weekly', '0 12 * * *',
      $$SELECT public.invoke_oraculo_feedback_worker('weekly')$$
    );
  END IF;
END
$cron$;

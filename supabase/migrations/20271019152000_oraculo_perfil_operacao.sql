-- SCRUM-599 · Perfil da Operação.
-- Perguntas nascem de medições; respostas formam histórico imutável. Ajuste de
-- admin não apaga a fala da pessoa: as duas versões seguem auditáveis.

CREATE TABLE public.oraculo_interview_questions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.oraculo_turns(id) ON DELETE CASCADE,
  asked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_team_member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  question_key text NOT NULL CHECK (question_key IN (
    'sales_outside_crm', 'meeting_definition', 'seasonality',
    'perceived_bottleneck', 'personal_practice'
  )),
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 1 AND 600),
  measured_context jsonb NOT NULL CHECK (jsonb_typeof(measured_context) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'skipped')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, question_key)
);

CREATE INDEX oraculo_interview_questions_owner_idx
  ON public.oraculo_interview_questions (asked_user_id, created_at DESC);

CREATE TABLE public.oraculo_operation_profile_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_team_member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.oraculo_interview_questions(id) ON DELETE SET NULL,
  question_key text NOT NULL CHECK (question_key IN (
    'sales_outside_crm', 'meeting_definition', 'seasonality',
    'perceived_bottleneck', 'personal_practice'
  )),
  answer text NOT NULL CHECK (char_length(btrim(answer)) BETWEEN 1 AND 2000),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_role text NOT NULL CHECK (author_role IN ('member', 'admin')),
  source text NOT NULL CHECK (source IN ('interview', 'settings')),
  measured_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(measured_context) = 'object'),
  previous_entry_id uuid REFERENCES public.oraculo_operation_profile_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oraculo_profile_current_idx
  ON public.oraculo_operation_profile_entries
  (organization_id, subject_team_member_id, question_key, author_role, created_at DESC);
CREATE INDEX oraculo_profile_adoption_idx
  ON public.oraculo_operation_profile_entries (organization_id, created_at DESC)
  WHERE author_role = 'member';

ALTER TABLE public.oraculo_interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_operation_profile_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oraculo_interview_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_operation_profile_entries FROM PUBLIC, anon, authenticated;

CREATE POLICY oraculo_interview_questions_owner_read
  ON public.oraculo_interview_questions FOR SELECT TO authenticated
  USING (
    asked_user_id = (SELECT auth.uid())
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );
GRANT SELECT ON public.oraculo_interview_questions TO authenticated;

-- O histórico reabre perguntas pela policy do dono. Respostas e ajustes sempre
-- atravessam a edge; nenhuma tabela aceita escrita direta do navegador.

CREATE OR REPLACE FUNCTION public.oraculo_meeting_profile_metrics(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_periodo_dias integer
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS since
  )
  SELECT jsonb_build_object(
    'reunioes_marcadas', count(*) FILTER (
      WHERE me.event_type = 'meeting_booked' AND me.occurred_at >= bounds.since
    ),
    'reunioes_realizadas', count(*) FILTER (
      WHERE me.event_type = 'meeting_held'
        AND coalesce(me.meeting_date, me.occurred_at) >= bounds.since
    )
  )
  FROM public.meeting_events me CROSS JOIN bounds
  WHERE me.organization_id = p_organization_id
    AND me.event_type IN ('meeting_booked', 'meeting_held')
    AND (p_team_member_id IS NULL OR me.pre_sale_responsible_id = p_team_member_id);
$$;
REVOKE ALL ON FUNCTION public.oraculo_meeting_profile_metrics(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_meeting_profile_metrics(uuid,uuid,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.oraculo_get_operation_profile(
  p_organization_id uuid,
  p_subject_team_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH member_latest AS (
    SELECT DISTINCT ON (subject_team_member_id, question_key)
      subject_team_member_id, subject_user_id, question_key,
      answer, author_user_id, created_at, measured_context
    FROM public.oraculo_operation_profile_entries
    WHERE organization_id = p_organization_id
      AND author_role = 'member'
      AND (p_subject_team_member_id IS NULL OR subject_team_member_id = p_subject_team_member_id)
    ORDER BY subject_team_member_id, question_key, revision DESC
  ),
  admin_latest AS (
    SELECT DISTINCT ON (subject_team_member_id, question_key)
      subject_team_member_id, question_key, answer, author_user_id, created_at
    FROM public.oraculo_operation_profile_entries
    WHERE organization_id = p_organization_id
      AND author_role = 'admin'
      AND (p_subject_team_member_id IS NULL OR subject_team_member_id = p_subject_team_member_id)
    ORDER BY subject_team_member_id, question_key, revision DESC
  ),
  current_rows AS (
    SELECT
      m.subject_team_member_id,
      tm.name AS team_member_name,
      m.question_key,
      m.answer AS member_answer,
      m.created_at AS member_answered_at,
      a.answer AS admin_answer,
      a.created_at AS admin_answered_at,
      coalesce(a.answer, m.answer) AS effective_answer,
      a.answer IS NOT NULL
        AND lower(btrim(a.answer)) IS DISTINCT FROM lower(btrim(m.answer)) AS divergent,
      m.measured_context
    FROM member_latest m
    JOIN public.team_members tm
      ON tm.id = m.subject_team_member_id AND tm.organization_id = p_organization_id
    LEFT JOIN admin_latest a
      ON a.subject_team_member_id = m.subject_team_member_id
     AND a.question_key = m.question_key
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'team_member_id', subject_team_member_id,
    'team_member_name', team_member_name,
    'question_key', question_key,
    'member_answer', member_answer,
    'member_answered_at', member_answered_at,
    'admin_answer', admin_answer,
    'admin_answered_at', admin_answered_at,
    'effective_answer', effective_answer,
    'divergent', divergent,
    'measured_context', measured_context
  ) ORDER BY team_member_name, question_key), '[]'::jsonb)
  FROM current_rows;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_get_profile_context(
  p_organization_id uuid,
  p_team_member_id uuid
)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT string_agg(
    format(
      '%s — %s: pessoa declarou "%s"%s%s',
      row->>'team_member_name',
      row->>'question_key',
      row->>'member_answer',
      CASE WHEN row->>'admin_answer' IS NOT NULL
        THEN format('; admin ajustou para "%s"', row->>'admin_answer') ELSE '' END,
      CASE WHEN (row->>'divergent')::boolean
        THEN '; divergência registrada' ELSE '' END
    ), E'\n' ORDER BY row->>'question_key'
  )
  FROM jsonb_array_elements(
    public.oraculo_get_operation_profile(p_organization_id, p_team_member_id)
  ) AS row;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_record_profile_response(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_member_id uuid,
  p_question_id uuid,
  p_answer text,
  p_skip boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_question public.oraculo_interview_questions%ROWTYPE;
  v_previous uuid;
BEGIN
  SELECT * INTO v_question
  FROM public.oraculo_interview_questions
  WHERE id = p_question_id
    AND organization_id = p_organization_id
    AND asked_user_id = p_user_id
    AND subject_team_member_id = p_team_member_id
    AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pergunta indisponível' USING ERRCODE = '42501'; END IF;

  IF p_skip THEN
    UPDATE public.oraculo_interview_questions
    SET status = 'skipped', responded_at = now()
    WHERE id = v_question.id;
    RETURN jsonb_build_object('status', 'skipped', 'question_id', v_question.id);
  END IF;
  IF char_length(btrim(coalesce(p_answer, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'resposta inválida' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_previous
  FROM public.oraculo_operation_profile_entries
  WHERE organization_id = p_organization_id
    AND subject_team_member_id = p_team_member_id
    AND question_key = v_question.question_key
    AND author_role = 'member'
  ORDER BY revision DESC LIMIT 1;

  INSERT INTO public.oraculo_operation_profile_entries (
    organization_id, subject_team_member_id, subject_user_id, question_id,
    question_key, answer, author_user_id, author_role, source,
    measured_context, previous_entry_id
  ) VALUES (
    p_organization_id, p_team_member_id, p_user_id, v_question.id,
    v_question.question_key, btrim(p_answer), p_user_id, 'member', 'interview',
    v_question.measured_context, v_previous
  );
  UPDATE public.oraculo_interview_questions
  SET status = 'answered', responded_at = now()
  WHERE id = v_question.id;
  RETURN jsonb_build_object('status', 'answered', 'question_id', v_question.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_edit_own_profile(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_member_id uuid,
  p_question_key text,
  p_answer text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_previous public.oraculo_operation_profile_entries%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE id = p_team_member_id AND organization_id = p_organization_id
      AND user_id = p_user_id AND is_active
  ) THEN RAISE EXCEPTION 'pessoa indisponível' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(coalesce(p_answer, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'resposta inválida' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_previous FROM public.oraculo_operation_profile_entries
  WHERE organization_id = p_organization_id AND subject_team_member_id = p_team_member_id
    AND question_key = p_question_key AND author_role = 'member'
  ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'perfil ainda não respondido' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.oraculo_operation_profile_entries (
    organization_id, subject_team_member_id, subject_user_id, question_key,
    answer, author_user_id, author_role, source, measured_context, previous_entry_id
  ) VALUES (
    p_organization_id, p_team_member_id, p_user_id, p_question_key,
    btrim(p_answer), p_user_id, 'member', 'settings',
    v_previous.measured_context, v_previous.id
  );
  RETURN jsonb_build_object('status', 'answered');
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_adjust_member_profile(
  p_organization_id uuid,
  p_admin_user_id uuid,
  p_subject_team_member_id uuid,
  p_question_key text,
  p_answer text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_subject_user_id uuid;
  v_member public.oraculo_operation_profile_entries%ROWTYPE;
  v_previous uuid;
BEGIN
  SELECT user_id INTO v_subject_user_id FROM public.team_members
  WHERE id = p_subject_team_member_id AND organization_id = p_organization_id;
  IF v_subject_user_id IS NULL THEN RAISE EXCEPTION 'pessoa indisponível' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(coalesce(p_answer, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'ajuste inválido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_member FROM public.oraculo_operation_profile_entries
  WHERE organization_id = p_organization_id
    AND subject_team_member_id = p_subject_team_member_id
    AND question_key = p_question_key AND author_role = 'member'
  ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'perfil ainda não respondido' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_previous FROM public.oraculo_operation_profile_entries
  WHERE organization_id = p_organization_id
    AND subject_team_member_id = p_subject_team_member_id
    AND question_key = p_question_key AND author_role = 'admin'
  ORDER BY revision DESC LIMIT 1;

  INSERT INTO public.oraculo_operation_profile_entries (
    organization_id, subject_team_member_id, subject_user_id, question_key,
    answer, author_user_id, author_role, source, measured_context, previous_entry_id
  ) VALUES (
    p_organization_id, p_subject_team_member_id, v_subject_user_id, p_question_key,
    btrim(p_answer), p_admin_user_id, 'admin', 'settings',
    v_member.measured_context, v_previous
  );
  RETURN jsonb_build_object(
    'status', 'answered',
    'divergent', lower(btrim(p_answer)) IS DISTINCT FROM lower(btrim(v_member.answer))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.oraculo_get_operation_profile(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_get_profile_context(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_record_profile_response(uuid,uuid,uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_edit_own_profile(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_adjust_member_profile(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_get_operation_profile(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_get_profile_context(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_record_profile_response(uuid,uuid,uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_edit_own_profile(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_adjust_member_profile(uuid,uuid,uuid,text,text) TO service_role;

CREATE VIEW public.oraculo_profile_adoption_60d
WITH (security_invoker = true)
AS
SELECT
  o.id AS organization_id,
  count(e.id) > 0 AS responded_last_60d,
  count(DISTINCT e.subject_team_member_id)::integer AS people_responded,
  count(e.id)::integer AS answers
FROM public.organizations o
LEFT JOIN public.oraculo_operation_profile_entries e
  ON e.organization_id = o.id
 AND e.author_role = 'member'
 AND e.created_at >= now() - interval '60 days'
GROUP BY o.id;
REVOKE ALL ON public.oraculo_profile_adoption_60d FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oraculo_profile_adoption_60d TO service_role;

-- Amplia a gravação atômica do turno: resposta, propostas e perguntas entram
-- juntas. O lock da conversa serializa duas respostas simultâneas e protege o
-- teto de três perguntas por sessão.
DROP FUNCTION public.oraculo_save_turn(uuid,uuid,uuid,timestamptz,text,jsonb,text);
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

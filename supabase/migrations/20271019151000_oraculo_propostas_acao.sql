-- SCRUM-598 · Proposta de Ação.
-- O modelo só prevê. O clique humano executa por outra fronteira HTTP.

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('followups.create', 'Follow-ups', 'Criar follow-up',
   'Cria tarefas de follow-up manualmente ou por proposta confirmada do Oráculo', false, true, 15)
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  name = EXCLUDED.name,
  description = EXCLUDED.description;

CREATE TABLE public.oraculo_action_proposals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.oraculo_turns(id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN
    ('mover_etapa', 'criar_follow_up', 'atribuir_responsavel', 'adicionar_tag')),
  criterion jsonb NOT NULL CHECK (criterion ? 'tipo'),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_count integer NOT NULL CHECK (preview_count >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  executed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_at timestamptz,
  execution_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oraculo_action_proposals_owner_pending_idx
  ON public.oraculo_action_proposals (proposed_by, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.oraculo_action_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY oraculo_action_proposals_owner_read
  ON public.oraculo_action_proposals FOR SELECT TO authenticated
  USING (
    proposed_by = (SELECT auth.uid())
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );
REVOKE ALL ON public.oraculo_action_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oraculo_action_proposals TO authenticated;

-- Um único predicado define previsão e execução. Retorna a entry aberta mais
-- recente quando a ação precisa de um card; nunca materializa alvos na proposta.
CREATE OR REPLACE FUNCTION public.oraculo_action_candidates(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_criterion jsonb,
  p_pipeline_id uuid DEFAULT NULL
)
RETURNS TABLE(lead_id uuid, entry_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.id, active_entry.id
  FROM public.leads l
  LEFT JOIN LATERAL (
    SELECT pe.id, pe.stage_changed_at, pe.entered_at, pe.created_at
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_organization_id
      AND pe.lead_id = l.id
      AND pe.closed_at IS NULL
      AND (p_pipeline_id IS NULL OR pe.pipeline_id = p_pipeline_id)
    ORDER BY coalesce(pe.stage_changed_at, pe.entered_at, pe.created_at) DESC, pe.id
    LIMIT 1
  ) active_entry ON true
  WHERE l.organization_id = p_organization_id
    AND l.deleted_at IS NULL
    AND coalesce(l.is_shadow, false) = false
    AND (p_pipeline_id IS NULL OR active_entry.id IS NOT NULL)
    AND (
      p_team_member_id IS NULL
      OR p_team_member_id IN (
        l.responsible_id, l.sdr_id, l.closer_id,
        l.pre_sale_responsible_id, l.sale_responsible_id
      )
    )
    AND (
      (
        p_criterion->>'tipo' = 'leads_parados'
        AND active_entry.id IS NOT NULL
        AND coalesce(active_entry.stage_changed_at, active_entry.entered_at, active_entry.created_at)
          < now() - make_interval(days => greatest(1, least(coalesce((p_criterion->>'dias')::integer, 14), 365)))
      )
      OR (
        p_criterion->>'tipo' = 'leads_sem_contato'
        AND NOT EXISTS (
          SELECT 1 FROM public.pipeline_entries pe_seen
          WHERE pe_seen.organization_id = p_organization_id
            AND pe_seen.lead_id = l.id
            AND pe_seen.stage_changed_at IS NOT NULL
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.oraculo_action_candidates(uuid,uuid,jsonb,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_action_candidates(uuid,uuid,jsonb,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.oraculo_preview_action_proposal(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_action_type text,
  p_criterion jsonb,
  p_parameters jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_resolved jsonb := '{}'::jsonb;
  v_pipeline_id uuid;
  v_pipeline_name text;
  v_stage_id uuid;
  v_stage_key text;
  v_stage_name text;
  v_member_id uuid;
  v_member_name text;
  v_tag_id uuid;
  v_tag_name text;
  v_matches integer;
  v_preview integer;
BEGIN
  IF p_action_type NOT IN ('mover_etapa','criar_follow_up','atribuir_responsavel','adicionar_tag') THEN
    RAISE EXCEPTION 'ação fora do catálogo' USING ERRCODE = '22023';
  END IF;
  IF p_criterion->>'tipo' NOT IN ('leads_parados','leads_sem_contato') THEN
    RAISE EXCEPTION 'critério fora do catálogo' USING ERRCODE = '22023';
  END IF;

  IF p_action_type = 'mover_etapa' THEN
    SELECT count(*) INTO v_matches
    FROM public.pipelines
    WHERE organization_id = p_organization_id AND is_active
      AND lower(btrim(coalesce(p_parameters->>'pipeline',''))) IN (lower(slug), lower(name));
    IF v_matches <> 1 THEN RAISE EXCEPTION 'funil ausente ou ambíguo' USING ERRCODE = '22023'; END IF;
    SELECT id, name INTO v_pipeline_id, v_pipeline_name
    FROM public.pipelines
    WHERE organization_id = p_organization_id AND is_active
      AND lower(btrim(coalesce(p_parameters->>'pipeline',''))) IN (lower(slug), lower(name));

    SELECT count(*) INTO v_matches
    FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND is_active
      AND lower(btrim(coalesce(p_parameters->>'etapa_destino',''))) IN (lower(stage_key), lower(name));
    IF v_matches <> 1 THEN RAISE EXCEPTION 'etapa ausente ou ambígua' USING ERRCODE = '22023'; END IF;
    SELECT id, stage_key, name INTO v_stage_id, v_stage_key, v_stage_name
    FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND is_active
      AND lower(btrim(coalesce(p_parameters->>'etapa_destino',''))) IN (lower(stage_key), lower(name));
    v_resolved := jsonb_build_object(
      'pipeline_id', v_pipeline_id,
      'pipeline_name', v_pipeline_name,
      'target_stage_id', v_stage_id,
      'target_stage_key', v_stage_key,
      'target_stage_name', v_stage_name
    );
  ELSIF p_action_type = 'atribuir_responsavel' THEN
    SELECT count(*) INTO v_matches
    FROM public.team_members
    WHERE organization_id = p_organization_id AND is_active
      AND lower(btrim(name)) = lower(btrim(coalesce(p_parameters->>'responsavel','')));
    IF v_matches <> 1 THEN RAISE EXCEPTION 'responsável ausente ou ambíguo' USING ERRCODE = '22023'; END IF;
    SELECT id, name INTO v_member_id, v_member_name
    FROM public.team_members
    WHERE organization_id = p_organization_id AND is_active
      AND lower(btrim(name)) = lower(btrim(coalesce(p_parameters->>'responsavel','')));
    v_resolved := jsonb_build_object('team_member_id', v_member_id, 'team_member_name', v_member_name);
  ELSIF p_action_type = 'adicionar_tag' THEN
    SELECT count(*) INTO v_matches
    FROM public.tags
    WHERE organization_id = p_organization_id
      AND lower(btrim(name)) = lower(btrim(coalesce(p_parameters->>'tag','')));
    IF v_matches <> 1 THEN RAISE EXCEPTION 'tag ausente ou ambígua' USING ERRCODE = '22023'; END IF;
    SELECT id, name INTO v_tag_id, v_tag_name
    FROM public.tags
    WHERE organization_id = p_organization_id
      AND lower(btrim(name)) = lower(btrim(coalesce(p_parameters->>'tag','')));
    v_resolved := jsonb_build_object('tag_id', v_tag_id, 'tag_name', v_tag_name);
  ELSE
    IF btrim(coalesce(p_parameters->>'titulo','')) = '' THEN
      RAISE EXCEPTION 'título do follow-up ausente' USING ERRCODE = '22023';
    END IF;
    v_resolved := jsonb_build_object(
      'titulo', left(btrim(p_parameters->>'titulo'), 160),
      'prazo_dias', greatest(0, least(coalesce((p_parameters->>'prazo_dias')::integer, 1), 365))
    );
  END IF;

  SELECT count(*) INTO v_preview
  FROM public.oraculo_action_candidates(
    p_organization_id, p_team_member_id, p_criterion, v_pipeline_id
  );

  RETURN jsonb_build_object('previsao', v_preview, 'parametros_resolvidos', v_resolved);
END;
$$;

REVOKE ALL ON FUNCTION public.oraculo_preview_action_proposal(uuid,uuid,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_preview_action_proposal(uuid,uuid,text,jsonb,jsonb)
  TO service_role;

-- Substitui a gravação atômica do turno para pendurar propostas no turno do
-- assistente. Proposta só nasce se pergunta, resposta e memória confirmarem.
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

CREATE OR REPLACE FUNCTION public.execute_oraculo_action_proposal(
  p_proposal_id uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal public.oraculo_action_proposals%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_feature text;
  v_allowed boolean := false;
  v_current integer := 0;
  v_applied integer := 0;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'autenticação obrigatória' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_proposal FROM public.oraculo_action_proposals
  WHERE id = p_proposal_id
    AND organization_id = p_organization_id
    AND proposed_by = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposta indisponível' USING ERRCODE = '42501'; END IF;
  IF v_proposal.status <> 'pending' THEN
    RETURN coalesce(v_proposal.execution_result, jsonb_build_object('status', v_proposal.status));
  END IF;
  IF v_proposal.expires_at <= now() THEN
    UPDATE public.oraculo_action_proposals SET status = 'expired' WHERE id = v_proposal.id;
    RETURN jsonb_build_object('status','aviso','codigo','proposta_expirada','alterados',0);
  END IF;

  v_feature := CASE v_proposal.action_type
    WHEN 'mover_etapa' THEN 'pipeline.move_cards'
    WHEN 'criar_follow_up' THEN 'followups.create'
    WHEN 'atribuir_responsavel' THEN 'leads.reassign'
    WHEN 'adicionar_tag' THEN 'leads.edit'
  END;
  v_allowed := EXISTS (
      SELECT 1 FROM public.master_users mu
      WHERE mu.user_id = v_user_id AND mu.is_active
    ) OR EXISTS (
      SELECT 1 FROM public.gestores g
      JOIN public.gestor_organizations go ON go.gestor_id = g.id
      WHERE g.user_id = v_user_id AND g.is_active
        AND go.organization_id = v_proposal.organization_id
    ) OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = v_user_id
        AND tm.organization_id = v_proposal.organization_id
        AND tm.is_active
        AND (tm.role = 'admin' OR public.has_feature_permission(v_feature, v_proposal.organization_id))
    );
  IF NOT v_allowed THEN RAISE EXCEPTION 'permissão recusada: %', v_feature USING ERRCODE = '42501'; END IF;

  -- IDs foram resolvidos no preview, mas podem ser desativados antes do
  -- clique. Revalidar aqui evita escrever com destino obsoleto.
  IF v_proposal.action_type = 'mover_etapa' AND NOT EXISTS (
    SELECT 1
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = (v_proposal.parameters->>'target_stage_id')::uuid
      AND ps.stage_key = v_proposal.parameters->>'target_stage_key'
      AND ps.pipeline_id = (v_proposal.parameters->>'pipeline_id')::uuid
      AND ps.organization_id = v_proposal.organization_id
      AND ps.is_active AND p.is_active
  ) THEN
    v_result := jsonb_build_object('status','aviso','codigo','destino_indisponivel','alterados',0);
  ELSIF v_proposal.action_type = 'atribuir_responsavel' AND NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = (v_proposal.parameters->>'team_member_id')::uuid
      AND tm.organization_id = v_proposal.organization_id AND tm.is_active
  ) THEN
    v_result := jsonb_build_object('status','aviso','codigo','destino_indisponivel','alterados',0);
  ELSIF v_proposal.action_type = 'adicionar_tag' AND NOT EXISTS (
    SELECT 1 FROM public.tags t
    WHERE t.id = (v_proposal.parameters->>'tag_id')::uuid
      AND t.organization_id = v_proposal.organization_id
  ) THEN
    v_result := jsonb_build_object('status','aviso','codigo','destino_indisponivel','alterados',0);
  END IF;

  IF v_result IS NOT NULL THEN
    UPDATE public.oraculo_action_proposals SET
      status = 'expired', executed_by = v_user_id, executed_at = now(), execution_result = v_result
    WHERE id = v_proposal.id;
    RETURN v_result;
  END IF;

  IF v_proposal.action_type = 'mover_etapa' THEN
    WITH candidates AS MATERIALIZED (
      SELECT * FROM public.oraculo_action_candidates(
        v_proposal.organization_id, v_proposal.scope_team_member_id,
        v_proposal.criterion, (v_proposal.parameters->>'pipeline_id')::uuid
      )
    ), moved AS (
      UPDATE public.pipeline_entries pe SET
        stage_id = (v_proposal.parameters->>'target_stage_id')::uuid,
        stage_key = v_proposal.parameters->>'target_stage_key',
        stage_changed_at = now(), updated_at = now()
      FROM candidates c
      WHERE pe.id = c.entry_id
        AND pe.organization_id = v_proposal.organization_id
        AND pe.stage_id IS DISTINCT FROM (v_proposal.parameters->>'target_stage_id')::uuid
      RETURNING pe.lead_id, pe.id
    ), history AS (
      INSERT INTO public.lead_history
        (lead_id, organization_id, action, description, created_by, source, entity_type, entity_id, metadata)
      SELECT lead_id, v_proposal.organization_id, 'oraculo_action_confirmed',
        'Etapa alterada por proposta do Oráculo confirmada por uma pessoa',
        v_user_id, 'manual', 'pipeline_entry', id,
        jsonb_build_object('proposal_id', v_proposal.id, 'action_type', v_proposal.action_type)
      FROM moved RETURNING 1
    )
    SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM history)
      INTO v_current, v_applied;
  ELSIF v_proposal.action_type = 'criar_follow_up' THEN
    WITH candidates AS MATERIALIZED (
      SELECT * FROM public.oraculo_action_candidates(
        v_proposal.organization_id, v_proposal.scope_team_member_id, v_proposal.criterion, NULL
      )
    ), created AS (
      INSERT INTO public.follow_ups
        (lead_id, pipeline_entry_id, assigned_to, title, due_date, is_automated, organization_id)
      SELECT c.lead_id, c.entry_id, l.responsible_id,
        v_proposal.parameters->>'titulo',
        now() + make_interval(days => (v_proposal.parameters->>'prazo_dias')::integer),
        false, v_proposal.organization_id
      FROM candidates c JOIN public.leads l ON l.id = c.lead_id
      RETURNING lead_id, id
    ), history AS (
      INSERT INTO public.lead_history
        (lead_id, organization_id, action, description, created_by, source, entity_type, entity_id, metadata)
      SELECT lead_id, v_proposal.organization_id, 'oraculo_action_confirmed',
        'Follow-up criado por proposta do Oráculo confirmada por uma pessoa',
        v_user_id, 'manual', 'follow_up', id,
        jsonb_build_object('proposal_id', v_proposal.id, 'action_type', v_proposal.action_type)
      FROM created RETURNING 1
    )
    SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM history)
      INTO v_current, v_applied;
  ELSIF v_proposal.action_type = 'atribuir_responsavel' THEN
    WITH candidates AS MATERIALIZED (
      SELECT * FROM public.oraculo_action_candidates(
        v_proposal.organization_id, v_proposal.scope_team_member_id, v_proposal.criterion, NULL
      )
    ), changed AS (
      UPDATE public.leads l SET
        responsible_id = (v_proposal.parameters->>'team_member_id')::uuid,
        updated_at = now()
      FROM candidates c
      WHERE l.id = c.lead_id
        AND l.organization_id = v_proposal.organization_id
        AND l.responsible_id IS DISTINCT FROM (v_proposal.parameters->>'team_member_id')::uuid
      RETURNING l.id
    ), history AS (
      INSERT INTO public.lead_history
        (lead_id, organization_id, action, description, created_by, source, metadata)
      SELECT id, v_proposal.organization_id, 'oraculo_action_confirmed',
        'Responsável atribuído por proposta do Oráculo confirmada por uma pessoa',
        v_user_id, 'manual',
        jsonb_build_object('proposal_id', v_proposal.id, 'action_type', v_proposal.action_type)
      FROM changed RETURNING 1
    )
    SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM history)
      INTO v_current, v_applied;
  ELSE
    WITH candidates AS MATERIALIZED (
      SELECT * FROM public.oraculo_action_candidates(
        v_proposal.organization_id, v_proposal.scope_team_member_id, v_proposal.criterion, NULL
      )
    ), tagged AS (
      INSERT INTO public.lead_tags (lead_id, tag_id)
      SELECT lead_id, (v_proposal.parameters->>'tag_id')::uuid FROM candidates
      ON CONFLICT (lead_id, tag_id) DO NOTHING
      RETURNING lead_id, id
    ), history AS (
      INSERT INTO public.lead_history
        (lead_id, organization_id, action, description, created_by, source, entity_type, entity_id, metadata)
      SELECT lead_id, v_proposal.organization_id, 'oraculo_action_confirmed',
        'Tag adicionada por proposta do Oráculo confirmada por uma pessoa',
        v_user_id, 'manual', 'lead_tag', id,
        jsonb_build_object('proposal_id', v_proposal.id, 'action_type', v_proposal.action_type)
      FROM tagged RETURNING 1
    )
    SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM history)
      INTO v_current, v_applied;
  END IF;

  v_result := jsonb_build_object(
    'status', CASE WHEN v_current = 0 OR v_applied = 0 THEN 'aviso' ELSE 'sucesso' END,
    'previstos', v_proposal.preview_count,
    'qualificaveis_no_clique', v_current,
    'alterados', v_applied,
    'ja_tratados', greatest(v_proposal.preview_count - v_applied, 0)
  );
  UPDATE public.oraculo_action_proposals SET
    status = 'executed', executed_by = v_user_id, executed_at = now(), execution_result = v_result
  WHERE id = v_proposal.id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_oraculo_action_proposal(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_oraculo_action_proposal(uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.execute_oraculo_action_proposal(uuid,uuid) IS
  'Executa proposta com auth.uid do clique. Critério é relido no mesmo statement da escrita; resultado distingue previsão, qualificáveis, alterados e já tratados.';

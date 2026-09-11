-- SCRUM-605 — briefing semanal do member, estritamente autoatribuído.

CREATE TABLE public.oraculo_member_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','expired')),
  headline text NOT NULL CHECK (char_length(headline) BETWEEN 1 AND 240),
  diagnostic jsonb NOT NULL CHECK (coalesce(diagnostic->>'status','') = 'bottleneck'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  seen_at timestamptz,
  UNIQUE (team_member_id, week_start),
  CHECK (expires_at = created_at + interval '7 days')
);
CREATE INDEX oraculo_member_briefings_live_idx
  ON public.oraculo_member_briefings (team_member_id, expires_at DESC)
  WHERE status <> 'expired';

CREATE TABLE public.oraculo_member_briefing_runs (
  team_member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('created','no_bottleneck')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_member_id, week_start)
);

CREATE TABLE public.oraculo_member_briefing_conversations (
  briefing_id uuid PRIMARY KEY REFERENCES public.oraculo_member_briefings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oraculo_member_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_member_briefing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_member_briefing_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oraculo_member_briefings, public.oraculo_member_briefing_runs,
  public.oraculo_member_briefing_conversations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.oraculo_member_briefings, public.oraculo_member_briefing_runs,
  public.oraculo_member_briefing_conversations TO service_role;

CREATE FUNCTION public.oraculo_member_briefing_due_at(p_timezone text, p_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT (p_at AT TIME ZONE p_timezone) >=
    date_trunc('week', p_at AT TIME ZONE p_timezone) + time '07:00';
$$;

CREATE FUNCTION public.oraculo_member_briefing_headline(p_diagnostic jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE WHEN p_diagnostic->>'status' = 'bottleneck' THEN left(format(
    'Seu funil pede atenção em %s nesta semana.',
    coalesce(p_diagnostic->'bottleneck'->>'label', 'um ponto da operação')
  ), 240) END;
$$;

-- Fila operacional do próprio vendedor. A atribuição usa os mesmos cinco
-- campos canônicos do executor de ações; nomes de terceiros nunca entram.
CREATE FUNCTION public.oraculo_member_briefing_worklist(
  p_organization_id uuid, p_team_member_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH owned AS MATERIALIZED (
    SELECT
      l.id AS lead_id,
      l.name AS lead_name,
      pe.id AS entry_id,
      pe.stage_key,
      coalesce(pe.stage_changed_at, pe.entered_at, pe.created_at) AS stage_since,
      coalesce(ps.name, pe.stage_key) AS stage_name
    FROM public.leads l
    JOIN LATERAL (
      SELECT candidate.*
      FROM public.pipeline_entries candidate
      WHERE candidate.organization_id = p_organization_id
        AND candidate.lead_id = l.id
        AND candidate.closed_at IS NULL
      ORDER BY coalesce(candidate.stage_changed_at, candidate.entered_at, candidate.created_at) DESC,
        candidate.id
      LIMIT 1
    ) pe ON true
    LEFT JOIN public.pipeline_stages ps
      ON ps.organization_id = p_organization_id
      AND ps.pipeline_id = pe.pipeline_id
      AND ps.stage_key = pe.stage_key
    WHERE l.organization_id = p_organization_id
      AND l.deleted_at IS NULL
      AND coalesce(l.is_shadow, false) = false
      AND p_team_member_id IN (
        l.responsible_id, l.sdr_id, l.closer_id,
        l.pre_sale_responsible_id, l.sale_responsible_id
      )
  ),
  stalled AS (
    SELECT o.lead_id, o.lead_name, o.stage_name,
      floor(extract(epoch FROM (now() - o.stage_since)) / 86400)::integer AS stalled_days
    FROM owned o
    WHERE o.stage_since < now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.follow_ups fu
        WHERE fu.lead_id = o.lead_id
          AND fu.completed_at IS NULL
          AND fu.archived_at IS NULL
      )
    ORDER BY o.stage_since, o.lead_id
    LIMIT 5
  ),
  proposals AS (
    SELECT o.lead_id, o.lead_name, o.stage_name,
      floor(extract(epoch FROM (now() - last_message.sent_at)) / 86400)::integer AS waiting_days
    FROM owned o
    JOIN LATERAL (
      SELECT message.direction, message.sent_at
      FROM (
        SELECT wm.direction, wm.timestamp AS sent_at
        FROM public.whatsapp_messages wm
        WHERE wm.organization_id = p_organization_id
          AND wm.lead_id = o.lead_id
          AND wm.deleted_at IS NULL
        UNION ALL
        SELECT cm.direction, cm.timestamp AS sent_at
        FROM public.channel_messages cm
        WHERE cm.organization_id = p_organization_id
          AND cm.lead_id = o.lead_id
      ) message
      ORDER BY message.sent_at DESC
      LIMIT 1
    ) last_message ON true
    WHERE lower(o.stage_name || ' ' || o.stage_key) LIKE '%propost%'
      AND last_message.direction = 'outgoing'
      AND last_message.sent_at < now() - interval '3 days'
    ORDER BY last_message.sent_at, o.lead_id
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'unanswered_proposals', coalesce((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.waiting_days DESC, p.lead_id)
      FROM proposals p
    ), '[]'::jsonb),
    'stalled_leads', coalesce((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stalled_days DESC, s.lead_id)
      FROM stalled s
    ), '[]'::jsonb)
  );
$$;

CREATE FUNCTION public.oraculo_member_briefing_content(p_headline text, p_diagnostic jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_item jsonb;
  v_content text := p_headline;
BEGIN
  IF jsonb_array_length(coalesce(p_diagnostic->'worklist'->'unanswered_proposals','[]'::jsonb)) > 0 THEN
    v_content := v_content || E'\n\nPropostas sem resposta:';
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_diagnostic->'worklist'->'unanswered_proposals')
    LOOP
      v_content := v_content || format(E'\n- %s — aguardando há %s dias',
        v_item->>'lead_name', v_item->>'waiting_days');
    END LOOP;
  END IF;
  IF jsonb_array_length(coalesce(p_diagnostic->'worklist'->'stalled_leads','[]'::jsonb)) > 0 THEN
    v_content := v_content || E'\n\nLeads parados sem próximo passo:';
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_diagnostic->'worklist'->'stalled_leads')
    LOOP
      v_content := v_content || format(E'\n- %s — parado há %s dias',
        v_item->>'lead_name', v_item->>'stalled_days');
    END LOOP;
  END IF;
  RETURN v_content || E'\n\nPrioridade: escolha o próximo passo e execute nesta semana.';
END;
$$;

CREATE FUNCTION public.generate_oraculo_member_briefings(
  p_at timestamptz DEFAULT clock_timestamp(), p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '55s' AS $$
DECLARE
  v_member record;
  v_diagnostic jsonb;
  v_week date;
  v_created integer := 0;
  v_without integer := 0;
  v_examined integer := 0;
BEGIN
  UPDATE public.oraculo_member_briefings SET status = 'expired'
  WHERE status <> 'expired' AND expires_at <= p_at;

  FOR v_member IN
    SELECT tm.id, tm.organization_id, o.timezone
    FROM public.team_members tm
    JOIN public.organizations o ON o.id = tm.organization_id
    WHERE tm.is_active AND tm.role = 'member'
      AND coalesce(o.is_sandbox,false) = false
      AND o.subscription_status IN ('active','trial','overdue')
      AND public.oraculo_member_briefing_due_at(o.timezone, p_at)
      AND NOT EXISTS (
        SELECT 1 FROM public.oraculo_member_briefing_runs r
        WHERE r.team_member_id = tm.id
          AND r.week_start = date_trunc('week', p_at AT TIME ZONE o.timezone)::date
      )
    ORDER BY tm.id
    LIMIT greatest(1, least(coalesce(p_limit,25),100))
  LOOP
    v_week := date_trunc('week', p_at AT TIME ZONE v_member.timezone)::date;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('oraculo-member-briefing:' || v_member.id::text || ':' || v_week::text, 0)) THEN
      CONTINUE;
    END IF;
    v_examined := v_examined + 1;
    SELECT public.oraculo_revenue_bottleneck(v_member.organization_id, v_member.id) INTO v_diagnostic;
    IF v_diagnostic->>'status' <> 'bottleneck' THEN
      INSERT INTO public.oraculo_member_briefing_runs(team_member_id,week_start,outcome,checked_at)
      VALUES (v_member.id,v_week,'no_bottleneck',p_at) ON CONFLICT DO NOTHING;
      v_without := v_without + 1;
      CONTINUE;
    END IF;
    v_diagnostic := v_diagnostic || jsonb_build_object(
      'worklist', public.oraculo_member_briefing_worklist(v_member.organization_id, v_member.id)
    );
    INSERT INTO public.oraculo_member_briefings(
      organization_id,team_member_id,week_start,headline,diagnostic,created_at,expires_at
    ) VALUES (
      v_member.organization_id,v_member.id,v_week,
      public.oraculo_member_briefing_headline(v_diagnostic),v_diagnostic,p_at,p_at + interval '7 days'
    ) ON CONFLICT (team_member_id,week_start) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.oraculo_member_briefing_runs(team_member_id,week_start,outcome,checked_at)
      VALUES (v_member.id,v_week,'created',p_at) ON CONFLICT DO NOTHING;
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('examined',v_examined,'created',v_created,
    'skipped_without_bottleneck',v_without,'model_calls',0);
END;
$$;

CREATE FUNCTION public.oraculo_member_briefing_current(p_organization_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id',b.id,'headline',b.headline,'status',b.status,'expires_at',b.expires_at,
    'local_date',b.week_start,'bottleneck',b.diagnostic->'bottleneck',
    'self_profile',b.diagnostic->'self_profile','people_evidence',b.diagnostic->'people_evidence',
    'worklist',b.diagnostic->'worklist',
    'conversation_id',bc.conversation_id
  )
  FROM public.oraculo_member_briefings b
  JOIN public.team_members tm ON tm.id=b.team_member_id
    AND tm.organization_id=p_organization_id AND tm.user_id=p_user_id
    AND tm.is_active AND tm.role='member'
  LEFT JOIN public.oraculo_member_briefing_conversations bc
    ON bc.briefing_id=b.id AND bc.user_id=p_user_id
  WHERE b.organization_id=p_organization_id AND b.expires_at>now() AND b.status<>'expired'
  ORDER BY b.created_at DESC LIMIT 1;
$$;

CREATE FUNCTION public.oraculo_open_member_briefing(
  p_briefing_id uuid,p_organization_id uuid,p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_briefing public.oraculo_member_briefings%ROWTYPE;
  v_conversation_id uuid;
  v_turn_id uuid;
BEGIN
  SELECT b.* INTO v_briefing
  FROM public.oraculo_member_briefings b
  JOIN public.team_members tm ON tm.id=b.team_member_id
    AND tm.organization_id=p_organization_id AND tm.user_id=p_user_id
    AND tm.is_active AND tm.role='member'
  WHERE b.id=p_briefing_id AND b.organization_id=p_organization_id
    AND b.expires_at>now() AND b.status<>'expired'
  FOR UPDATE OF b;
  IF NOT FOUND THEN RAISE EXCEPTION 'briefing_indisponivel' USING ERRCODE='42501'; END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.oraculo_member_briefing_conversations
  WHERE briefing_id=p_briefing_id AND user_id=p_user_id;
  IF v_conversation_id IS NULL THEN
    INSERT INTO public.oraculo_conversations(
      organization_id,user_id,team_member_id,title,summary,last_message_at,created_at,updated_at
    ) VALUES (
      p_organization_id,p_user_id,v_briefing.team_member_id,
      'Seu briefing da semana de ' || to_char(v_briefing.week_start,'DD/MM/YYYY'),
      'Conversa iniciada pelo briefing semanal do próprio funil.',
      clock_timestamp(),clock_timestamp(),clock_timestamp()
    ) RETURNING id INTO v_conversation_id;
    INSERT INTO public.oraculo_turns(
      conversation_id,organization_id,user_id,role,content,tools_used,rejected_tools,
      hit_tool_ceiling,model,created_at
    ) VALUES (
      v_conversation_id,p_organization_id,p_user_id,'assistant',
      public.oraculo_member_briefing_content(v_briefing.headline, v_briefing.diagnostic),
      ARRAY['gargalo'], '{}', false, NULL, clock_timestamp()
    ) RETURNING id INTO v_turn_id;
    INSERT INTO public.oraculo_member_briefing_conversations(briefing_id,user_id,conversation_id)
    VALUES (p_briefing_id,p_user_id,v_conversation_id);
  END IF;
  UPDATE public.oraculo_member_briefings
  SET status=CASE WHEN status='new' THEN 'seen' ELSE status END,
      seen_at=coalesce(seen_at,clock_timestamp())
  WHERE id=p_briefing_id;
  RETURN jsonb_build_object('briefing_id',p_briefing_id,'conversa_id',v_conversation_id,'propostas',0);
END;
$$;

REVOKE ALL ON FUNCTION public.oraculo_member_briefing_due_at(text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oraculo_member_briefing_headline(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oraculo_member_briefing_worklist(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oraculo_member_briefing_content(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.generate_oraculo_member_briefings(timestamptz,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oraculo_member_briefing_current(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oraculo_open_member_briefing(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generate_oraculo_member_briefings(timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_member_briefing_worklist(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_member_briefing_current(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_open_member_briefing(uuid,uuid,uuid) TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='oraculo-member-briefing') THEN
      PERFORM cron.unschedule('oraculo-member-briefing');
    END IF;
    PERFORM cron.schedule('oraculo-member-briefing','*/5 * * * *',
      $$SELECT public.generate_oraculo_member_briefings()$$);
  END IF;
END $cron$;

COMMENT ON TABLE public.oraculo_member_briefings IS
  'Briefing semanal individual. Diagnóstico restrito ao próprio funil; expira exatamente em sete dias.';

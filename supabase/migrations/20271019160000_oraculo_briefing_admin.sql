-- SCRUM-603 — briefing diário do admin, determinístico e silencioso sem gargalo.

CREATE TABLE public.oraculo_admin_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'acted', 'expired')),
  headline text NOT NULL CHECK (char_length(headline) BETWEEN 1 AND 240),
  diagnostic jsonb NOT NULL CHECK (coalesce(diagnostic->>'status', '') = 'bottleneck'),
  initial_leaked_revenue numeric NOT NULL CHECK (initial_leaked_revenue > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  seen_at timestamptz,
  acted_by_click_at timestamptz,
  improved_at timestamptz,
  shrinkage_outcome text CHECK (shrinkage_outcome IN ('improved', 'decayed', 'unchanged')),
  shrinkage_measured_at timestamptz,
  current_leaked_revenue numeric,
  progressed_leads integer,
  decayed_leads integer,
  UNIQUE (organization_id, local_date),
  CHECK (expires_at = created_at + interval '24 hours')
);

CREATE INDEX oraculo_admin_briefings_live_idx
  ON public.oraculo_admin_briefings (organization_id, expires_at DESC)
  WHERE status <> 'expired';
CREATE INDEX oraculo_admin_briefings_shrinkage_idx
  ON public.oraculo_admin_briefings (created_at)
  WHERE shrinkage_measured_at IS NULL;

-- Ledger técnico impede recalcular um "sem gargalo" a cada cinco minutos.
-- Não é briefing e nunca chega ao navegador.
CREATE TABLE public.oraculo_admin_briefing_runs (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('created', 'no_bottleneck')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, local_date)
);

CREATE TABLE public.oraculo_admin_briefing_conversations (
  briefing_id uuid NOT NULL REFERENCES public.oraculo_admin_briefings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (briefing_id, user_id)
);

ALTER TABLE public.oraculo_action_proposals
  ADD COLUMN briefing_id uuid REFERENCES public.oraculo_admin_briefings(id) ON DELETE SET NULL;
CREATE INDEX oraculo_action_proposals_briefing_idx
  ON public.oraculo_action_proposals (briefing_id)
  WHERE briefing_id IS NOT NULL;

ALTER TABLE public.oraculo_admin_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_admin_briefing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_admin_briefing_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oraculo_admin_briefings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_admin_briefing_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oraculo_admin_briefing_conversations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.oraculo_admin_briefings TO service_role;
GRANT ALL ON public.oraculo_admin_briefing_runs TO service_role;
GRANT ALL ON public.oraculo_admin_briefing_conversations TO service_role;

CREATE OR REPLACE FUNCTION public.oraculo_admin_briefing_headline(p_diagnostic jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE WHEN p_diagnostic->>'status' = 'bottleneck' THEN left(format(
    'Gargalo em %s: cerca de R$ %s em receita vazada no período.',
    coalesce(p_diagnostic->'bottleneck'->>'label', 'ponto da operação'),
    trim(to_char(
      coalesce((p_diagnostic->'bottleneck'->>'estimated_leaked_revenue')::numeric, 0),
      'FM999G999G999G990D00'
    ))
  ), 240) END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_admin_briefing_stagger_minute(
  p_organization_id uuid
)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT mod(mod(hashtextextended(p_organization_id::text, 603), 60) + 60, 60)::integer;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_admin_briefing_due_at(
  p_organization_id uuid,
  p_timezone text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (p_at AT TIME ZONE p_timezone) >=
    date_trunc('day', p_at AT TIME ZONE p_timezone)
    + time '07:00'
    + make_interval(mins => public.oraculo_admin_briefing_stagger_minute(p_organization_id));
$$;

CREATE OR REPLACE FUNCTION public.generate_oraculo_admin_briefings(
  p_at timestamptz DEFAULT clock_timestamp(),
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '55s'
AS $$
DECLARE
  v_org record;
  v_diagnostic jsonb;
  v_created integer := 0;
  v_without_bottleneck integer := 0;
  v_examined integer := 0;
BEGIN
  UPDATE public.oraculo_admin_briefings
  SET status = 'expired'
  WHERE status <> 'expired' AND expires_at <= p_at;

  FOR v_org IN
    SELECT o.id, o.timezone, (p_at AT TIME ZONE o.timezone)::date AS local_date
    FROM public.organizations o
    WHERE coalesce(o.is_sandbox, false) = false
      AND o.subscription_status IN ('active', 'trial', 'overdue')
      AND public.oraculo_admin_briefing_due_at(o.id, o.timezone, p_at)
      AND NOT EXISTS (
        SELECT 1 FROM public.oraculo_admin_briefing_runs r
        WHERE r.organization_id = o.id
          AND r.local_date = (p_at AT TIME ZONE o.timezone)::date
      )
    ORDER BY public.oraculo_admin_briefing_stagger_minute(o.id), o.id
    LIMIT greatest(1, least(coalesce(p_limit, 5), 25))
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('oraculo-briefing:' || v_org.id::text, 0)) THEN
      CONTINUE;
    END IF;
    v_examined := v_examined + 1;
    SELECT public.oraculo_revenue_bottleneck(v_org.id, NULL) INTO v_diagnostic;
    IF v_diagnostic->>'status' <> 'bottleneck' THEN
      INSERT INTO public.oraculo_admin_briefing_runs (
        organization_id, local_date, outcome, checked_at
      ) VALUES (v_org.id, v_org.local_date, 'no_bottleneck', p_at)
      ON CONFLICT (organization_id, local_date) DO NOTHING;
      v_without_bottleneck := v_without_bottleneck + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.oraculo_admin_briefings (
      organization_id, local_date, headline, diagnostic,
      initial_leaked_revenue, created_at, expires_at
    ) VALUES (
      v_org.id, v_org.local_date,
      public.oraculo_admin_briefing_headline(v_diagnostic), v_diagnostic,
      (v_diagnostic->'bottleneck'->>'estimated_leaked_revenue')::numeric,
      p_at, p_at + interval '24 hours'
    ) ON CONFLICT (organization_id, local_date) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.oraculo_admin_briefing_runs (
        organization_id, local_date, outcome, checked_at
      ) VALUES (v_org.id, v_org.local_date, 'created', p_at)
      ON CONFLICT (organization_id, local_date) DO NOTHING;
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'examined', v_examined,
    'created', v_created,
    'skipped_without_bottleneck', v_without_bottleneck,
    'model_calls', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_admin_briefing_current(
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', b.id,
    'headline', b.headline,
    'status', b.status,
    'expires_at', b.expires_at,
    'local_date', b.local_date,
    'bottleneck', b.diagnostic->'bottleneck',
    'conversation_id', bc.conversation_id
  )
  FROM public.oraculo_admin_briefings b
  LEFT JOIN public.oraculo_admin_briefing_conversations bc
    ON bc.briefing_id = b.id AND bc.user_id = p_user_id
  WHERE b.organization_id = p_organization_id
    AND b.expires_at > now()
    AND b.status <> 'expired'
    AND (
      EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.organization_id = p_organization_id AND tm.user_id = p_user_id
          AND tm.is_active AND tm.role = 'admin'
      )
      OR EXISTS (
        SELECT 1 FROM public.master_users mu
        WHERE mu.user_id = p_user_id AND mu.is_active
      )
    )
  ORDER BY b.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_open_admin_briefing(
  p_briefing_id uuid,
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_briefing public.oraculo_admin_briefings%ROWTYPE;
  v_conversation_id uuid;
  v_turn_id uuid;
  v_team_member_id uuid;
  v_preview jsonb;
  v_proposals integer := 0;
  v_criterion jsonb;
BEGIN
  SELECT tm.id INTO v_team_member_id
  FROM public.team_members tm
  WHERE tm.organization_id = p_organization_id AND tm.user_id = p_user_id
    AND tm.is_active AND tm.role = 'admin'
  LIMIT 1;
  IF v_team_member_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.master_users mu WHERE mu.user_id = p_user_id AND mu.is_active
  ) THEN
    RAISE EXCEPTION 'briefing_indisponivel' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_briefing
  FROM public.oraculo_admin_briefings
  WHERE id = p_briefing_id AND organization_id = p_organization_id
    AND expires_at > now() AND status <> 'expired'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'briefing_indisponivel' USING ERRCODE = '42501'; END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.oraculo_admin_briefing_conversations
  WHERE briefing_id = p_briefing_id AND user_id = p_user_id;

  IF v_conversation_id IS NULL THEN
    INSERT INTO public.oraculo_conversations (
      organization_id, user_id, team_member_id, title, summary,
      last_message_at, created_at, updated_at
    ) VALUES (
      p_organization_id, p_user_id, v_team_member_id,
      'Briefing de ' || to_char(v_briefing.local_date, 'DD/MM/YYYY'),
      'Conversa iniciada pelo briefing diário determinístico.',
      clock_timestamp(), clock_timestamp(), clock_timestamp()
    ) RETURNING id INTO v_conversation_id;

    INSERT INTO public.oraculo_turns (
      conversation_id, organization_id, user_id, role, content, tools_used,
      rejected_tools, hit_tool_ceiling, model, created_at
    ) VALUES (
      v_conversation_id, p_organization_id, p_user_id, 'assistant',
      v_briefing.headline || E'\n\nPrioridade: revisar os Leads parados e definir o próximo passo hoje.',
      ARRAY['gargalo'], '{}', false, NULL, clock_timestamp()
    ) RETURNING id INTO v_turn_id;

    v_criterion := jsonb_build_object('tipo', 'leads_parados', 'dias', 14);
    SELECT public.oraculo_preview_action_proposal(
      p_organization_id, NULL, 'criar_follow_up', v_criterion,
      jsonb_build_object('titulo', 'Revisar Lead parado no gargalo', 'prazo_dias', 1)
    ) INTO v_preview;
    IF coalesce((v_preview->>'previsao')::integer, 0) > 0 THEN
      INSERT INTO public.oraculo_action_proposals (
        id, organization_id, conversation_id, turn_id, proposed_by,
        scope_team_member_id, action_type, criterion, parameters,
        preview_count, briefing_id
      ) VALUES (
        gen_random_uuid(), p_organization_id, v_conversation_id, v_turn_id, p_user_id,
        NULL, 'criar_follow_up', v_criterion, v_preview->'parametros_resolvidos',
        (v_preview->>'previsao')::integer, p_briefing_id
      );
      v_proposals := v_proposals + 1;
    END IF;

    INSERT INTO public.oraculo_admin_briefing_conversations (
      briefing_id, user_id, conversation_id
    ) VALUES (p_briefing_id, p_user_id, v_conversation_id);
  ELSE
    SELECT count(*) INTO v_proposals FROM public.oraculo_action_proposals
    WHERE briefing_id = p_briefing_id AND proposed_by = p_user_id;
  END IF;

  UPDATE public.oraculo_admin_briefings
  SET status = CASE WHEN status = 'new' THEN 'seen' ELSE status END,
      seen_at = coalesce(seen_at, clock_timestamp())
  WHERE id = p_briefing_id;

  RETURN jsonb_build_object(
    'briefing_id', p_briefing_id,
    'conversa_id', v_conversation_id,
    'propostas', v_proposals
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_oraculo_briefing_acted_by_click()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'executed' AND NEW.briefing_id IS NOT NULL THEN
    UPDATE public.oraculo_admin_briefings
    SET status = CASE WHEN status = 'expired' THEN status ELSE 'acted' END,
        acted_by_click_at = coalesce(acted_by_click_at, NEW.executed_at, clock_timestamp())
    WHERE id = NEW.briefing_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_oraculo_briefing_acted_by_click
AFTER UPDATE OF status ON public.oraculo_action_proposals
FOR EACH ROW EXECUTE FUNCTION public.mark_oraculo_briefing_acted_by_click();

CREATE OR REPLACE FUNCTION public.measure_oraculo_admin_briefing_shrinkage(
  p_at timestamptz DEFAULT clock_timestamp(),
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '55s'
AS $$
DECLARE
  v_briefing public.oraculo_admin_briefings%ROWTYPE;
  v_current jsonb;
  v_current_revenue numeric;
  v_progressed integer;
  v_decayed integer;
  v_outcome text;
  v_measured integer := 0;
BEGIN
  FOR v_briefing IN
    SELECT * FROM public.oraculo_admin_briefings
    WHERE shrinkage_measured_at IS NULL
      AND created_at + interval '72 hours' <= p_at
    ORDER BY created_at
    LIMIT greatest(1, least(coalesce(p_limit, 25), 50))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT public.oraculo_revenue_bottleneck(v_briefing.organization_id, NULL) INTO v_current;
    v_current_revenue := CASE
      WHEN v_current->>'status' = 'bottleneck'
       AND v_current->'bottleneck'->>'dimension' = v_briefing.diagnostic->'bottleneck'->>'dimension'
       AND v_current->'bottleneck'->>'key' = v_briefing.diagnostic->'bottleneck'->>'key'
      THEN (v_current->'bottleneck'->>'estimated_leaked_revenue')::numeric
      ELSE 0
    END;

    SELECT
      count(DISTINCT pse.lead_id) FILTER (
        WHERE coalesce(target.stage_role::text, 'open') <> 'lost'
          AND coalesce(target.position, 0) > coalesce(source.position, -1)
      ),
      count(DISTINCT pse.lead_id) FILTER (WHERE target.stage_role::text = 'lost')
    INTO v_progressed, v_decayed
    FROM public.pipeline_stage_events pse
    LEFT JOIN public.pipeline_stages source
      ON source.pipeline_id = pse.pipeline_id AND source.stage_key = pse.from_stage_key
    LEFT JOIN public.pipeline_stages target
      ON target.pipeline_id = pse.pipeline_id AND target.stage_key = pse.to_stage_key
    WHERE pse.organization_id = v_briefing.organization_id
      AND pse.occurred_at >= v_briefing.created_at
      AND pse.occurred_at < v_briefing.created_at + interval '72 hours';

    v_progressed := coalesce(v_progressed, 0);
    v_decayed := coalesce(v_decayed, 0);
    v_outcome := CASE
      WHEN v_current_revenue >= v_briefing.initial_leaked_revenue THEN 'unchanged'
      WHEN v_progressed > v_decayed THEN 'improved'
      ELSE 'decayed'
    END;

    UPDATE public.oraculo_admin_briefings SET
      current_leaked_revenue = v_current_revenue,
      progressed_leads = v_progressed,
      decayed_leads = v_decayed,
      shrinkage_outcome = v_outcome,
      shrinkage_measured_at = p_at,
      improved_at = CASE WHEN v_outcome = 'improved' THEN p_at ELSE improved_at END,
      status = CASE WHEN v_outcome = 'improved' AND status <> 'expired' THEN 'acted' ELSE status END
    WHERE id = v_briefing.id;
    v_measured := v_measured + 1;
  END LOOP;
  RETURN jsonb_build_object('measured', v_measured);
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_admin_briefing_metrics(
  p_since timestamptz DEFAULT now() - interval '30 days'
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'generated', count(*),
    'opened', count(*) FILTER (WHERE seen_at IS NOT NULL),
    'acted_by_click', count(*) FILTER (WHERE acted_by_click_at IS NOT NULL),
    'shrinkage_improved', count(*) FILTER (WHERE shrinkage_outcome = 'improved'),
    'shrinkage_decayed', count(*) FILTER (WHERE shrinkage_outcome = 'decayed'),
    'open_rate_pct', CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE seen_at IS NOT NULL) / count(*), 1) END,
    'shrinkage_rate_pct', CASE WHEN count(*) FILTER (WHERE shrinkage_measured_at IS NOT NULL) = 0 THEN 0
      ELSE round(100.0 * count(*) FILTER (WHERE shrinkage_outcome = 'improved') /
        count(*) FILTER (WHERE shrinkage_measured_at IS NOT NULL), 1) END
  )
  FROM public.oraculo_admin_briefings
  WHERE created_at >= p_since;
$$;

REVOKE ALL ON FUNCTION public.oraculo_admin_briefing_headline(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_admin_briefing_stagger_minute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_admin_briefing_due_at(uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_oraculo_admin_briefings(timestamptz,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_admin_briefing_current(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_open_admin_briefing(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_oraculo_briefing_acted_by_click() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.measure_oraculo_admin_briefing_shrinkage(timestamptz,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_admin_briefing_metrics(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_oraculo_admin_briefings(timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_admin_briefing_current(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_open_admin_briefing(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.measure_oraculo_admin_briefing_shrinkage(timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_admin_briefing_metrics(timestamptz) TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-admin-briefing') THEN
      PERFORM cron.unschedule('oraculo-admin-briefing');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-admin-briefing-shrinkage') THEN
      PERFORM cron.unschedule('oraculo-admin-briefing-shrinkage');
    END IF;
    PERFORM cron.schedule(
      'oraculo-admin-briefing', '*/5 * * * *',
      $$SELECT public.generate_oraculo_admin_briefings()$$
    );
    PERFORM cron.schedule(
      'oraculo-admin-briefing-shrinkage', '7,22,37,52 * * * *',
      $$SELECT public.measure_oraculo_admin_briefing_shrinkage()$$
    );
  END IF;
END
$cron$;

COMMENT ON TABLE public.oraculo_admin_briefings IS
  'Briefing diário por organização. Só existe quando o diagnóstico determinístico encontra gargalo; expira em 24h.';

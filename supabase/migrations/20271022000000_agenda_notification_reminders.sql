-- Created with `supabase migration new agenda_notification_reminders` on
-- 2026-09-24. Ordered after the repository's synthetic 2027 migration ledger.
-- No backfill: only future cron runs produce notifications.
-- Meetings created in the internal agenda were absent from the old sweep.
-- Follow-ups ran once at 07:00, missing everything created later that day.

-- Older producers (handoff/support) omit this column. Keep newly created
-- notices in the same chronological feed without rewriting historical rows.
ALTER TABLE public.notifications ALTER COLUMN last_event_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS notifications_reminder_lookup_idx
  ON public.notifications (organization_id, user_id, group_key)
  WHERE group_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS pipeline_entries_pending_meeting_reminder_idx
  ON public.pipeline_entries (id)
  WHERE closed_at IS NULL AND NULLIF(metadata ->> 'meeting_date', '') IS NOT NULL;
CREATE INDEX IF NOT EXISTS follow_ups_pending_reminder_date_idx
  ON public.follow_ups (due_date)
  WHERE completed_at IS NULL AND archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_followups()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_key text;
  v_total integer := 0;
  v_dia text := to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM-DD');
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('avisos:followups', 0)) THEN RETURN 0; END IF;
  FOR r IN
    SELECT f.*, l.name AS lead_nome, tm.user_id AS destinatario
    FROM public.follow_ups f
    JOIN public.leads l ON l.id = f.lead_id AND l.organization_id = f.organization_id
    JOIN public.team_members tm ON tm.organization_id = f.organization_id
      AND tm.is_active AND tm.user_id IS NOT NULL
      AND tm.user_id = COALESCE(
        (SELECT a.user_id FROM public.team_members a WHERE a.id = f.assigned_to
          AND a.organization_id = f.organization_id AND a.is_active AND a.user_id IS NOT NULL),
        public.fn_dono_do_lead(f.lead_id))
    WHERE f.completed_at IS NULL AND f.archived_at IS NULL AND l.deleted_at IS NULL
      AND f.due_date <= now() + interval '15 minutes'
      -- Old overdue tasks remain a morning reminder, not a midnight alarm.
      AND (f.due_date >= now() - interval '1 hour'
        OR extract(hour FROM timezone('America/Sao_Paulo', now())) >= 7)
  LOOP
    v_key := 'fup:' || r.organization_id || ':' || r.id || ':' ||
      extract(epoch FROM r.due_date)::text || ':' || v_dia;
    -- Reading a reminder must never re-arm the same scheduled occurrence.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.organization_id = r.organization_id AND n.user_id = r.destinatario AND n.group_key = v_key);
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => r.destinatario,
      p_type => CASE WHEN r.due_date < now() THEN 'follow_up_overdue' ELSE 'follow_up_due' END,
      p_group_key => v_key,
      p_title => CASE WHEN r.due_date < now() THEN 'Follow-up atrasado' ELSE 'Follow-up em até 15 minutos' END,
      p_description => concat_ws(' · ', NULLIF(r.title, ''), r.lead_nome,
        to_char(timezone('America/Sao_Paulo', r.due_date), 'DD/MM HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_reuniao_proxima()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_data timestamptz;
  v_dono uuid;
  v_lead_nome text;
  v_key text;
  v_total integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('avisos:reunioes', 0)) THEN RETURN 0; END IF;

  -- Includes meetings without a lead/deal and follow-ups created as agenda
  -- activities. Creator + invited active members, never an organization broadcast.
  FOR r IN
    SELECT DISTINCT m.id, m.organization_id, m.lead_id, m.title, m.start_at,
      m.event_type, tm.user_id AS destinatario, l.name AS lead_nome
    FROM public.meetings m
    LEFT JOIN public.leads l ON l.id = m.lead_id AND l.organization_id = m.organization_id
    JOIN public.team_members tm ON tm.organization_id = m.organization_id
      AND tm.is_active AND tm.user_id IS NOT NULL
      AND (tm.user_id = m.created_by OR EXISTS (
        SELECT 1 FROM public.meeting_participants mp WHERE mp.meeting_id = m.id
          AND mp.team_member_id = tm.id AND mp.status <> 'declined'))
    WHERE m.status = 'scheduled' AND NOT m.all_day
      AND m.event_type IN ('meeting', 'call', 'follow_up', 'task', 'other')
      AND (m.lead_id IS NULL OR (l.id IS NOT NULL AND l.deleted_at IS NULL))
      AND m.start_at BETWEEN now() - interval '5 minutes' AND now() + interval '15 minutes'
  LOOP
    v_key := 'agenda:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM r.start_at)::text;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.organization_id = r.organization_id AND n.user_id = r.destinatario AND n.group_key = v_key);
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => r.destinatario,
      p_type => CASE WHEN r.event_type = 'follow_up' THEN 'follow_up_due' ELSE 'meeting_soon' END,
      p_group_key => v_key,
      p_title => CASE WHEN r.start_at <= now() THEN
          CASE WHEN r.event_type = 'follow_up' THEN 'Follow-up para agora' ELSE 'Compromisso começando agora' END
        WHEN r.event_type = 'follow_up' THEN 'Follow-up em até 15 minutos' ELSE 'Compromisso em até 15 minutos' END,
      p_description => concat_ws(' · ', NULLIF(r.title, ''), r.lead_nome,
        to_char(timezone('America/Sao_Paulo', r.start_at), 'HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;

  -- Preserve appointments created in funnels, which need not have a meetings
  -- row. A malformed legacy date must not stop all organizations' reminders.
  FOR r IN
    SELECT pe.*
    FROM public.pipeline_entries pe
    WHERE pe.closed_at IS NULL
      AND NULLIF(pe.metadata ->> 'meeting_date', '') IS NOT NULL
  LOOP
    BEGIN
      v_data := (r.metadata ->> 'meeting_date')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
    END;
    CONTINUE WHEN v_data NOT BETWEEN now() - interval '5 minutes' AND now() + interval '15 minutes';
    SELECT l.name INTO v_lead_nome FROM public.leads l
      WHERE l.id = r.lead_id AND l.organization_id = r.organization_id AND l.deleted_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    -- The canonical agenda row owns its status and participants. Suppress its
    -- projection even when cancelled/completed, otherwise it resurrects here.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meetings m
      WHERE m.organization_id = r.organization_id AND (
        m.id::text = r.metadata #>> '{agenda_espelho,meeting_id}'
        OR ((m.pipeline_entry_id = r.id OR m.deal_id = r.deal_id) AND m.start_at = v_data)
        OR (m.lead_id = r.lead_id AND m.start_at = v_data)));
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meeting_events booked
      JOIN public.meeting_events outcome ON outcome.booked_event_id = booked.id
        AND outcome.organization_id = booked.organization_id
        AND outcome.event_type IN ('meeting_held', 'meeting_no_show')
      WHERE booked.organization_id = r.organization_id AND booked.source_entry_id = r.id
        AND booked.meeting_date = v_data);
    v_dono := COALESCE(
      (SELECT tm.user_id FROM public.team_members tm WHERE tm.id = r.assigned_to
        AND tm.organization_id = r.organization_id AND tm.is_active AND tm.user_id IS NOT NULL),
      public.fn_dono_do_lead(r.lead_id));
    CONTINUE WHEN v_dono IS NULL OR NOT EXISTS (SELECT 1 FROM public.team_members tm
      WHERE tm.organization_id = r.organization_id AND tm.user_id = v_dono AND tm.is_active);
    v_key := 'meet_soon:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM v_data)::text;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.organization_id = r.organization_id AND n.user_id = v_dono AND n.group_key = v_key);
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => v_dono, p_type => 'meeting_soon',
      p_group_key => v_key,
      p_title => CASE WHEN v_data <= now() THEN 'Reunião começando agora' ELSE 'Reunião em até 15 minutos' END,
      p_description => concat_ws(' · ', v_lead_nome, to_char(timezone('America/Sao_Paulo', v_data), 'HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_varredura_avisos_followups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_varredura_avisos_reuniao_proxima() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_varredura_avisos_followups() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_varredura_avisos_reuniao_proxima() TO service_role;

COMMENT ON FUNCTION public.fn_varredura_avisos_followups IS
  'Follow-ups em até 15 minutos + atrasados, idempotentes por data marcada/dia/destinatário, inclusive depois de lidos.';
COMMENT ON FUNCTION public.fn_varredura_avisos_reuniao_proxima IS
  'Agenda interna + funil: lembretes 15 min antes para membros ativos da própria organização, sem duplicar espelhos.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Reuses named jobs (pg_cron updates existing schedule/command).
    PERFORM cron.schedule('avisos-varredura-followups', '* * * * *', 'SELECT public.fn_varredura_avisos_followups()');
    PERFORM cron.schedule('avisos-varredura-reuniao-proxima', '* * * * *', 'SELECT public.fn_varredura_avisos_reuniao_proxima()');
  END IF;
END $$;

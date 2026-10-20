-- ROLLBACK de 20271202000000_varreduras_de_avisos_set_based.sql
-- Restaura o corpo das duas varreduras vigente em prod em 19/10 (o de
-- 20271126000000, md5 conferido no teste), o índice parcial antigo do 2º laço
-- da reunião e o COMMENT de fn_donos_do_lead; remove o índice de expressão e
-- private.fn_aviso_meeting_date_aprox. Rode inteiro, na ordem: as funções
-- antigas não leem o índice novo, então o índice sai depois delas.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE INDEX IF NOT EXISTS pipeline_entries_pending_meeting_reminder_idx
  ON public.pipeline_entries (id)
  WHERE closed_at IS NULL AND NULLIF(metadata ->> 'meeting_date', '') IS NOT NULL;

-- ─── 4. fn_varredura_avisos_followups  (parte de: 20271022000000_agenda_notification_reminders.sql) ───
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
      -- Atribuído a alguém: só essa pessoa. Sem atribuído: TODOS os donos do lead
      -- (Chamado 793f4b05 · PR4b); um membro em dois papéis é um usuário só.
      AND tm.user_id = ANY(CASE WHEN EXISTS (SELECT 1 FROM public.team_members a WHERE a.id = f.assigned_to
          AND a.organization_id = f.organization_id AND a.is_active AND a.user_id IS NOT NULL)
        THEN ARRAY[(SELECT a.user_id FROM public.team_members a WHERE a.id = f.assigned_to
          AND a.organization_id = f.organization_id AND a.is_active AND a.user_id IS NOT NULL)]
        ELSE public.fn_donos_do_lead(f.lead_id) END)
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

-- ─── 5. fn_varredura_avisos_reuniao_proxima  (parte de: 20271022000000_agenda_notification_reminders.sql) ───
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_reuniao_proxima()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_data timestamptz;
  v_dono uuid;
  v_donos uuid[];
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
        -- Lead/time is only a legacy fallback. Explicit links above already
        -- cover matching IDs; a different meeting, entry or deal is another
        -- appointment even when its lead and scheduled instant coincide.
        OR (m.lead_id = r.lead_id AND m.start_at = v_data
          AND NULLIF(r.metadata #>> '{agenda_espelho,meeting_id}', '') IS NULL
          AND m.pipeline_entry_id IS NULL
          AND (m.deal_id IS NULL OR r.deal_id IS NULL))));
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meeting_events booked
      JOIN public.meeting_events outcome ON outcome.booked_event_id = booked.id
        AND outcome.organization_id = booked.organization_id
        AND outcome.event_type IN ('meeting_held', 'meeting_no_show')
      WHERE booked.organization_id = r.organization_id AND booked.source_entry_id = r.id
        AND booked.meeting_date = v_data);
    -- Atribuído a alguém: só essa pessoa. Sem atribuído: TODOS os donos do lead
    -- (Chamado 793f4b05 · PR4b). Um usuário em dois papéis recebe um aviso.
    v_donos := ARRAY(SELECT tm.user_id FROM public.team_members tm WHERE tm.id = r.assigned_to
      AND tm.organization_id = r.organization_id AND tm.is_active AND tm.user_id IS NOT NULL);
    IF cardinality(v_donos) = 0 THEN
      v_donos := public.fn_donos_do_lead(r.lead_id);
    END IF;
    v_key := 'meet_soon:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM v_data)::text;
    FOREACH v_dono IN ARRAY v_donos LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.team_members tm
        WHERE tm.organization_id = r.organization_id AND tm.user_id = v_dono AND tm.is_active);
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
  END LOOP;
  RETURN v_total;
END;
$$;

DROP INDEX IF EXISTS public.pipeline_entries_meeting_reminder_at_idx;
DROP FUNCTION IF EXISTS private.fn_aviso_meeting_date_aprox(text);

COMMENT ON FUNCTION public.fn_donos_do_lead(uuid) IS
  'Contas de usuário que recebem o aviso do lead: TODOS os donos (principais por papel + co-donos de lead_owners), principal primeiro, sem repetir usuário. Org sem a flag lead_owners_n_donos: só o principal (= fn_dono_do_lead). fn_dono_do_lead segue existindo para quem lê o principal. Chamado 793f4b05 · PR4b.';

COMMIT;

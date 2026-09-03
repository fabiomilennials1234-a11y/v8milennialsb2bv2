-- Rollback do backfill S4 (20270907000020).
--
-- DUAS coisas, e as duas são necessárias:
--
--  1. Restaura `get_agenda_events` na definição anterior (20270831000020) — a
--     de CINCO fontes, sem a guarda da Source 4. Sem isto o rollback deixaria
--     a função apontando para um estado que nunca mais existirá, e
--     `tests/unit/agenda-fontes-contract.test.ts` cobra exatamente isso: o
--     rollback tem de RESTAURAR as fontes, não só existir com o nome certo.
--
--  2. Apaga as linhas que o backfill criou. A procedência em `external_ref` é
--     o que torna isto possível — reunião criada por gente não tem o prefixo e
--     não é tocada. Nenhuma outra tabela é alterada: `meeting_events` e
--     `pipe_confirmacao` nunca foram lidos destrutivamente.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_agenda_events(p_organization_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(id uuid, source text, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, all_day boolean, event_type text, status text, lead_id uuid, lead_name text, lead_company text, created_by uuid, creator_name text, location text, meet_link text, color text, google_event_id text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY

  -- Source 1: meetings
  SELECT
    m.id,
    'meeting'::text AS source,
    m.title,
    m.description,
    m.start_at,
    m.end_at,
    m.all_day,
    m.event_type,
    m.status,
    m.lead_id,
    l.name AS lead_name,
    l.company AS lead_company,
    m.created_by,
    tm.name AS creator_name,
    m.location,
    m.meet_link,
    m.color,
    m.google_event_id
  FROM public.meetings m
  LEFT JOIN public.leads l ON l.id = m.lead_id
  -- `team_members.user_id` NÃO é único: um master tem uma linha por org em que
  -- é membro. Sem o predicado de org o join FANOUT — cada meeting aparecia N
  -- vezes na agenda (medido: 16x, criador membro de 15 orgs). As demais sources
  -- juntam por `team_members.id` (PK) e não têm esse problema.
  LEFT JOIN public.team_members tm
    ON tm.user_id = m.created_by
   AND tm.organization_id = m.organization_id
  WHERE m.organization_id = p_organization_id
    AND m.start_at < p_end
    AND m.end_at > p_start

  UNION ALL

  -- Source 2: follow_ups (non-archived, with due_date in range)
  SELECT
    fu.id,
    'follow_up'::text AS source,
    fu.title,
    fu.description,
    fu.due_date AS start_at,
    fu.due_date + interval '30 minutes' AS end_at,
    false AS all_day,
    'follow_up'::text AS event_type,
    CASE
      WHEN fu.completed_at IS NOT NULL THEN 'completed'
      ELSE 'scheduled'
    END AS status,
    fu.lead_id,
    l2.name AS lead_name,
    l2.company AS lead_company,
    fu.assigned_to AS created_by,
    tm2.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.follow_ups fu
  LEFT JOIN public.leads l2 ON l2.id = fu.lead_id
  LEFT JOIN public.team_members tm2 ON tm2.id = fu.assigned_to
  WHERE fu.organization_id = p_organization_id
    AND fu.archived_at IS NULL
    AND fu.due_date >= p_start
    AND fu.due_date < p_end

  UNION ALL

  -- Source 3: scheduled_user_messages (only scheduled/sending)
  SELECT
    sm.id,
    'scheduled_message'::text AS source,
    COALESCE(
      LEFT(sm.message_content, 60),
      'Mensagem agendada'
    ) AS title,
    sm.message_content AS description,
    sm.scheduled_at AS start_at,
    sm.scheduled_at + interval '5 minutes' AS end_at,
    false AS all_day,
    'task'::text AS event_type,
    sm.status,
    sm.lead_id,
    l3.name AS lead_name,
    l3.company AS lead_company,
    sm.created_by,
    tm3.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.scheduled_user_messages sm
  LEFT JOIN public.leads l3 ON l3.id = sm.lead_id
  LEFT JOIN public.team_members tm3 ON tm3.id = sm.created_by
  WHERE sm.organization_id = p_organization_id
    AND sm.status IN ('scheduled', 'sending')
    AND sm.scheduled_at >= p_start
    AND sm.scheduled_at < p_end

  UNION ALL

  -- Source 4: pipe_confirmacao (entries with non-null meeting_date)
  SELECT
    pc.id,
    'pipe_confirmacao'::text AS source,
    COALESCE(l4.name, 'Reuniao') AS title,
    pc.notes AS description,
    pc.meeting_date AS start_at,
    pc.meeting_date + interval '1 hour' AS end_at,
    false AS all_day,
    'meeting'::text AS event_type,
    pc.status::text AS status,
    pc.lead_id,
    l4.name AS lead_name,
    l4.company AS lead_company,
    COALESCE(pc.closer_id, pc.sdr_id) AS created_by, -- metric-lint-allow: agenda não é métrica de atribuição; é "quem marcou" para exibir na linha, preservado byte-a-byte de 20260985000000
    COALESCE(tm_closer.name, tm_sdr.name) AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.pipe_confirmacao pc
  LEFT JOIN public.leads l4 ON l4.id = pc.lead_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = pc.closer_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = pc.sdr_id
  WHERE pc.organization_id = p_organization_id
    AND pc.meeting_date IS NOT NULL
    AND pc.meeting_date >= p_start
    AND pc.meeting_date < p_end

  UNION ALL

  -- Source 5: meeting_events (funil mergeado — ADR-0004 / ADR-0007)
  SELECT
    me.id,
    'meeting_event'::text AS source,
    COALESCE(l5.name, 'Reuniao') AS title,
    NULL::text AS description,
    me.meeting_date AS start_at,
    me.meeting_date + interval '1 hour' AS end_at,
    false AS all_day,
    'meeting'::text AS event_type,
    me.held_status AS status,
    me.lead_id,
    l5.name AS lead_name,
    l5.company AS lead_company,
    me.pre_sale_responsible_id AS created_by,
    tm5.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM (
    SELECT DISTINCT ON (e.lead_id, e.meeting_date)
      e.id, e.lead_id, e.meeting_date, e.pre_sale_responsible_id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.meeting_events h
          WHERE h.booked_event_id = e.id AND h.event_type = 'meeting_held'
        ) THEN 'completed'
        ELSE 'scheduled'
      END AS held_status
    FROM public.meeting_events e
    WHERE e.organization_id = p_organization_id
      AND e.event_type = 'meeting_booked'
      AND e.meeting_date IS NOT NULL
      -- já representadas pela Source 4 (fonte viva, reflete remarcação)
      AND e.source IS DISTINCT FROM 'pipeline:confirmacao'
      -- carga histórica, não pertence à agenda
      AND (e.source IS NULL OR e.source NOT LIKE 'backfill:%')
      AND e.meeting_date >= p_start
      AND e.meeting_date < p_end
    ORDER BY e.lead_id, e.meeting_date, e.occurred_at DESC
  ) me
  LEFT JOIN public.leads l5 ON l5.id = me.lead_id
  LEFT JOIN public.team_members tm5 ON tm5.id = me.pre_sale_responsible_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipe_confirmacao pc2
    WHERE pc2.lead_id = me.lead_id AND pc2.meeting_date = me.meeting_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.meetings m2
    WHERE m2.lead_id = me.lead_id AND m2.start_at = me.meeting_date
  )

  ORDER BY start_at ASC;
END;
$function$;

SELECT count(*) AS linhas_a_remover
FROM public.meetings
WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';

DELETE FROM public.meetings
WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';

COMMIT;

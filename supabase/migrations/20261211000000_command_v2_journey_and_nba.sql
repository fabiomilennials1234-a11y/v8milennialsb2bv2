-- Comando v2 — conserta duas RPCs mortas-de-nascença (diagnóstico 2026-06-11):
--
-- 1) get_sales_cycle_analysis lia metadata->>'from_stage'/'to_stage', mas os
--    writers de lead_history sempre gravaram metadata = {} (a etapa só existe
--    em texto na description: 'Etapa alterada para "X" no Funil Y').
--    Reescrita: deriva to_stage da description (com fallback pro metadata,
--    caso writers futuros passem a gravar estruturado), deriva from_stage via
--    LAG por lead, e passa a respeitar p_pipeline_type (era declarado e
--    ignorado). Funciona retroativamente sobre todo o histórico.
--
-- 2) get_next_best_actions lia a tabela next_best_actions, que tem ZERO rows
--    em todas as orgs — o gerador nunca foi construído. Reescrita: deriva as
--    ações on-demand de fontes reais (follow-ups vencidos, propostas paradas,
--    reuniões marcadas sem comparecimento), com UNION das rows da tabela caso
--    um produtor passe a existir. Rows derivadas levam metadata.derived=true
--    (o front esconde "dispensar", que não se aplica a rows sintéticas).

CREATE OR REPLACE FUNCTION get_sales_cycle_analysis(
  p_pipeline_type text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  from_stage text,
  to_stage text,
  avg_hours numeric,
  median_hours numeric,
  transition_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT
      lh.lead_id,
      lh.created_at,
      COALESCE(
        NULLIF(lh.metadata->>'to_stage', ''),
        substring(lh.description from 'para "([^"]+)"')
      ) AS to_s,
      COALESCE(
        NULLIF(lh.metadata->>'pipeline', ''),
        substring(lh.description from '(?:no|na) ((?:Funil|Pipe) .+)$')
      ) AS pipe_label
    FROM lead_history lh
    WHERE lh.organization_id = v_org_id
      AND lh.action IN ('stage_changed', 'proposal_status_changed')
      AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
      AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
  ),
  seq AS (
    SELECT
      e.to_s,
      e.pipe_label,
      LAG(e.to_s) OVER (PARTITION BY e.lead_id ORDER BY e.created_at) AS from_s,
      EXTRACT(EPOCH FROM (
        e.created_at - LAG(e.created_at) OVER (PARTITION BY e.lead_id ORDER BY e.created_at)
      )) / 3600.0 AS hours_diff
    FROM ev e
    WHERE e.to_s IS NOT NULL
  )
  SELECT
    s.from_s,
    s.to_s,
    ROUND(AVG(s.hours_diff)::numeric, 1) AS avg_h,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.hours_diff))::numeric, 1) AS median_h,
    COUNT(*) AS cnt
  FROM seq s
  WHERE s.from_s IS NOT NULL
    AND s.from_s <> s.to_s
    AND s.hours_diff IS NOT NULL AND s.hours_diff > 0
    AND (
      p_pipeline_type IS NULL
      OR s.pipe_label ILIKE '%' || p_pipeline_type || '%'
      -- aliases: front chama 'whatsapp'/'confirmacao'/'propostas'
      OR (p_pipeline_type = 'whatsapp' AND s.pipe_label ILIKE '%WhatsApp%')
      OR (p_pipeline_type = 'confirmacao' AND s.pipe_label ILIKE '%Confirma%')
      OR (p_pipeline_type = 'propostas' AND s.pipe_label ILIKE '%Proposta%')
    )
  GROUP BY s.from_s, s.to_s
  ORDER BY cnt DESC
  LIMIT 12;
END;
$$;

CREATE OR REPLACE FUNCTION get_next_best_actions(p_limit int DEFAULT 10)
RETURNS TABLE(
  id uuid,
  lead_id uuid,
  lead_name text,
  deal_id uuid,
  action_type text,
  title text,
  reason text,
  priority int,
  due_by timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH stored AS (
    -- Rows persistidas (produtor futuro) — hoje a tabela está vazia
    SELECT
      nba.id, nba.lead_id, l.name AS lead_name, nba.deal_id,
      nba.action_type, nba.title, nba.reason, nba.priority, nba.due_by,
      nba.metadata
    FROM next_best_actions nba
    LEFT JOIN leads l ON l.id = nba.lead_id
    WHERE nba.organization_id = v_org_id
      AND nba.completed_at IS NULL
      AND nba.dismissed_at IS NULL
  ),
  overdue_followups AS (
    SELECT
      md5('fu:' || fu.id::text)::uuid AS id,
      fu.lead_id,
      l.name AS lead_name,
      NULL::uuid AS deal_id,
      'follow_up'::text AS action_type,
      ('Follow-up atrasado: ' || COALESCE(NULLIF(fu.title, ''), 'sem título'))::text AS title,
      ('Vencido há ' || GREATEST(EXTRACT(DAY FROM now() - fu.due_date)::int, 1) ||
       ' dia(s) — resgate rápido recupera o lead antes de esfriar.')::text AS reason,
      9 AS priority,
      fu.due_date AS due_by,
      jsonb_build_object('derived', true, 'source', 'follow_ups') AS metadata
    FROM follow_ups fu
    LEFT JOIN leads l ON l.id = fu.lead_id
    WHERE fu.organization_id = v_org_id
      AND fu.completed_at IS NULL
      AND fu.archived_at IS NULL
      AND fu.due_date < now()
    ORDER BY fu.due_date ASC
    LIMIT 5
  ),
  stale_proposals AS (
    SELECT
      md5('pp:' || pp.id::text)::uuid AS id,
      pp.lead_id,
      l.name AS lead_name,
      pp.id AS deal_id,
      'send_proposal'::text AS action_type,
      ('Proposta parada há ' || EXTRACT(DAY FROM now() - pp.updated_at)::int || ' dias')::text AS title,
      ('Sem movimento desde ' || to_char(pp.updated_at, 'DD/MM') ||
       CASE WHEN COALESCE(pp.sale_value, 0) > 0
         THEN ' — R$ ' || to_char(pp.sale_value, 'FM999G999G999') || ' em jogo.'
         ELSE ' — retome o contato hoje.' END)::text AS reason,
      7 AS priority,
      NULL::timestamptz AS due_by,
      jsonb_build_object('derived', true, 'source', 'pipe_propostas') AS metadata
    FROM pipe_propostas pp
    LEFT JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = v_org_id
      AND pp.status NOT IN ('vendido', 'perdido')
      AND pp.updated_at < now() - interval '7 days'
    ORDER BY COALESCE(pp.sale_value, 0) DESC, pp.updated_at ASC
    LIMIT 5
  ),
  missed_meetings AS (
    -- meeting_booked com data passada (14d) sem meeting_held correspondente
    -- e sem nova reunião futura marcada pro mesmo lead
    SELECT
      md5('mb:' || mb.id::text)::uuid AS id,
      mb.lead_id,
      l.name AS lead_name,
      NULL::uuid AS deal_id,
      'meeting'::text AS action_type,
      'Reagendar reunião perdida'::text AS title,
      ('Reunião de ' || to_char(COALESCE(mb.meeting_date, mb.occurred_at), 'DD/MM') ||
       ' não aconteceu e o lead segue sem novo horário.')::text AS reason,
      6 AS priority,
      NULL::timestamptz AS due_by,
      jsonb_build_object('derived', true, 'source', 'meeting_events') AS metadata
    FROM meeting_events mb
    LEFT JOIN leads l ON l.id = mb.lead_id
    WHERE mb.organization_id = v_org_id
      AND mb.event_type = 'meeting_booked'
      AND COALESCE(mb.meeting_date, mb.occurred_at) BETWEEN now() - interval '14 days' AND now()
      AND NOT EXISTS (
        SELECT 1 FROM meeting_events mh
        WHERE mh.organization_id = v_org_id
          AND mh.event_type = 'meeting_held'
          AND (mh.booked_event_id = mb.id
               OR (mh.lead_id = mb.lead_id
                   AND mh.occurred_at >= COALESCE(mb.meeting_date, mb.occurred_at)))
      )
      AND NOT EXISTS (
        SELECT 1 FROM meeting_events mf
        WHERE mf.organization_id = v_org_id
          AND mf.event_type = 'meeting_booked'
          AND mf.lead_id = mb.lead_id
          AND COALESCE(mf.meeting_date, mf.occurred_at) > now()
      )
    ORDER BY COALESCE(mb.meeting_date, mb.occurred_at) DESC
    LIMIT 4
  )
  SELECT * FROM (
    SELECT * FROM stored
    UNION ALL SELECT * FROM overdue_followups
    UNION ALL SELECT * FROM stale_proposals
    UNION ALL SELECT * FROM missed_meetings
  ) AS unioned
  ORDER BY unioned.priority DESC, unioned.due_by ASC NULLS LAST
  LIMIT p_limit;
END;
$$;

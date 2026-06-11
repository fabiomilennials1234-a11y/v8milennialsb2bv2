-- RPCs SECURITY DEFINER org-aware (diagnóstico 2026-06-11).
--
-- Briefing do Oráculo, Jornada do lead, Mapa e Win/Loss derivavam a org via
-- `team_members WHERE user_id = auth.uid() LIMIT 1` — sem ORDER BY. Usuário
-- com vários team_members (masters: 16 orgs) caía numa org arbitrária
-- ("Organização Principal"), não na org selecionada no front → blocos vazios
-- em prod pro CTO enquanto a RPC retornava cheio pra membros single-org.
--
-- Fix: todas aceitam p_org_id (a org ativa no front) validado por membership;
-- sem p_org_id mantém o comportamento antigo (retrocompat de chamadas velhas).

CREATE OR REPLACE FUNCTION resolve_org_for_rpc(p_org_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  IF p_org_id IS NOT NULL THEN
    -- só entrega a org pedida se o usuário for membro dela
    SELECT tm.organization_id INTO v FROM team_members tm
    WHERE tm.user_id = auth.uid() AND tm.organization_id = p_org_id
    LIMIT 1;
    RETURN v;
  END IF;
  SELECT tm.organization_id INTO v FROM team_members tm
  WHERE tm.user_id = auth.uid() LIMIT 1;
  RETURN v;
END;
$$;

-- ── get_next_best_actions ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_next_best_actions(int);
CREATE OR REPLACE FUNCTION get_next_best_actions(p_limit int DEFAULT 10, p_org_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, lead_id uuid, lead_name text, deal_id uuid, action_type text,
  title text, reason text, priority int, due_by timestamptz, metadata jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH stored AS (
    SELECT nba.id, nba.lead_id, l.name, nba.deal_id, nba.action_type, nba.title,
           nba.reason, nba.priority, nba.due_by, nba.metadata
    FROM next_best_actions nba LEFT JOIN leads l ON l.id = nba.lead_id
    WHERE nba.organization_id = v_org_id AND nba.completed_at IS NULL AND nba.dismissed_at IS NULL
  ),
  overdue_followups AS (
    SELECT md5('fu:'||fu.id::text)::uuid, fu.lead_id, l.name, NULL::uuid,
      'follow_up'::text, ('Follow-up atrasado: '||COALESCE(NULLIF(fu.title,''),'sem título'))::text,
      ('Vencido há '||GREATEST(EXTRACT(DAY FROM now()-fu.due_date)::int,1)||' dia(s) — resgate rápido recupera o lead antes de esfriar.')::text,
      9, fu.due_date, jsonb_build_object('derived',true,'source','follow_ups')
    FROM follow_ups fu LEFT JOIN leads l ON l.id = fu.lead_id
    WHERE fu.organization_id = v_org_id AND fu.completed_at IS NULL AND fu.archived_at IS NULL AND fu.due_date < now()
    ORDER BY fu.due_date ASC LIMIT 5
  ),
  stale_proposals AS (
    SELECT md5('pp:'||pp.id::text)::uuid, pp.lead_id, l.name, pp.id,
      'send_proposal'::text, ('Proposta parada há '||EXTRACT(DAY FROM now()-pp.updated_at)::int||' dias')::text,
      ('Sem movimento desde '||to_char(pp.updated_at,'DD/MM')||CASE WHEN COALESCE(pp.sale_value,0)>0 THEN ' — R$ '||to_char(pp.sale_value,'FM999G999G999')||' em jogo.' ELSE ' — retome o contato hoje.' END)::text,
      7, NULL::timestamptz, jsonb_build_object('derived',true,'source','pipe_propostas')
    FROM pipe_propostas pp LEFT JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = v_org_id AND pp.status NOT IN ('vendido','perdido') AND pp.updated_at < now() - interval '7 days'
    ORDER BY COALESCE(pp.sale_value,0) DESC, pp.updated_at ASC LIMIT 5
  ),
  missed_meetings AS (
    SELECT md5('mb:'||mb.id::text)::uuid, mb.lead_id, l.name, NULL::uuid,
      'meeting'::text, 'Reagendar reunião perdida'::text,
      ('Reunião de '||to_char(COALESCE(mb.meeting_date,mb.occurred_at),'DD/MM')||' não aconteceu e o lead segue sem novo horário.')::text,
      6, NULL::timestamptz, jsonb_build_object('derived',true,'source','meeting_events')
    FROM meeting_events mb LEFT JOIN leads l ON l.id = mb.lead_id
    WHERE mb.organization_id = v_org_id AND mb.event_type = 'meeting_booked'
      AND COALESCE(mb.meeting_date,mb.occurred_at) BETWEEN now() - interval '14 days' AND now()
      AND NOT EXISTS (SELECT 1 FROM meeting_events mh WHERE mh.organization_id = v_org_id AND mh.event_type='meeting_held'
        AND (mh.booked_event_id = mb.id OR (mh.lead_id = mb.lead_id AND mh.occurred_at >= COALESCE(mb.meeting_date,mb.occurred_at))))
      AND NOT EXISTS (SELECT 1 FROM meeting_events mf WHERE mf.organization_id = v_org_id AND mf.event_type='meeting_booked'
        AND mf.lead_id = mb.lead_id AND COALESCE(mf.meeting_date,mf.occurred_at) > now())
    ORDER BY COALESCE(mb.meeting_date,mb.occurred_at) DESC LIMIT 4
  ),
  hot_idle_leads AS (
    -- blindagem "fila nunca vazia": leads quentes parados há 48h+
    SELECT md5('hl:'||l.id::text)::uuid, l.id, l.name, NULL::uuid,
      'call'::text, 'Resgatar lead quente parado'::text,
      ('Qualificação alta e sem movimento desde '||to_char(l.updated_at,'DD/MM')||' — um contato hoje mantém o lead vivo.')::text,
      5, NULL::timestamptz, jsonb_build_object('derived',true,'source','leads')
    FROM leads l
    WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL
      AND (l.rating >= 4 OR l.qualification_score >= 70)
      AND l.updated_at < now() - interval '48 hours'
      AND NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.lead_id = l.id AND fu.completed_at IS NULL AND fu.archived_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')
    ORDER BY l.qualification_score DESC NULLS LAST, l.rating DESC NULLS LAST, l.updated_at ASC
    LIMIT 4
  )
  SELECT * FROM (
    SELECT * FROM stored
    UNION ALL SELECT * FROM overdue_followups
    UNION ALL SELECT * FROM stale_proposals
    UNION ALL SELECT * FROM missed_meetings
    UNION ALL SELECT * FROM hot_idle_leads
  ) AS unioned
  ORDER BY unioned.priority DESC, unioned.due_by ASC NULLS LAST
  LIMIT p_limit;
END; $$;

-- ── get_sales_cycle_analysis ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_sales_cycle_analysis(text, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION get_sales_cycle_analysis(
  p_pipeline_type text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE(from_stage text, to_stage text, avg_hours numeric, median_hours numeric, transition_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH ev AS (
    SELECT lh.lead_id, lh.created_at,
      COALESCE(NULLIF(lh.metadata->>'to_stage',''), substring(lh.description from 'para "([^"]+)"')) AS to_s,
      COALESCE(NULLIF(lh.metadata->>'pipeline',''), substring(lh.description from '(?:no|na) ((?:Funil|Pipe) .+)$')) AS pipe_label
    FROM lead_history lh
    WHERE lh.organization_id = v_org_id
      AND lh.action IN ('stage_changed','proposal_status_changed')
      AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
      AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
  ),
  seq AS (
    SELECT e.to_s, e.pipe_label,
      LAG(e.to_s) OVER (PARTITION BY e.lead_id ORDER BY e.created_at) AS from_s,
      EXTRACT(EPOCH FROM (e.created_at - LAG(e.created_at) OVER (PARTITION BY e.lead_id ORDER BY e.created_at)))/3600.0 AS hours_diff
    FROM ev e WHERE e.to_s IS NOT NULL
  )
  SELECT s.from_s, s.to_s, ROUND(AVG(s.hours_diff)::numeric,1),
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.hours_diff))::numeric,1), COUNT(*)
  FROM seq s
  WHERE s.from_s IS NOT NULL AND s.from_s <> s.to_s AND s.hours_diff IS NOT NULL AND s.hours_diff > 0
    AND (p_pipeline_type IS NULL
      OR s.pipe_label ILIKE '%'||p_pipeline_type||'%'
      OR (p_pipeline_type='whatsapp' AND s.pipe_label ILIKE '%WhatsApp%')
      OR (p_pipeline_type='confirmacao' AND s.pipe_label ILIKE '%Confirma%')
      OR (p_pipeline_type='propostas' AND s.pipe_label ILIKE '%Proposta%'))
  GROUP BY s.from_s, s.to_s ORDER BY COUNT(*) DESC LIMIT 12;
END; $$;

-- ── get_uf_heatmap ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_uf_heatmap();
CREATE OR REPLACE FUNCTION get_uf_heatmap(p_org_id uuid DEFAULT NULL)
RETURNS TABLE(uf char(2), leads_count bigint, clients_count bigint, total_sold numeric, unmapped_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_org_id uuid; v_unmapped bigint;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_unmapped FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NULL;
  RETURN QUERY
  SELECT l.uf, count(*)::bigint,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'))::bigint,
    COALESCE(SUM((SELECT SUM(pp.sale_value) FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')), 0)::numeric,
    v_unmapped
  FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NOT NULL
  GROUP BY l.uf;
END; $$;

-- ── get_leads_by_uf ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_leads_by_uf(char, int);
CREATE OR REPLACE FUNCTION get_leads_by_uf(p_uf char(2), p_limit int DEFAULT 60, p_org_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, company text, phone text, uf_source text, is_client boolean, sold_value numeric, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT l.id, l.name, l.company, l.phone, l.uf_source,
    EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'),
    COALESCE((SELECT SUM(pp.sale_value) FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'), 0)::numeric,
    l.created_at
  FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf
  ORDER BY 7 DESC, l.created_at DESC
  LIMIT p_limit;
END; $$;

-- ── get_win_loss_analysis ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_win_loss_analysis(timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION get_win_loss_analysis(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE(loss_reason text, count bigint, total_value numeric, pct numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id uuid; v_total bigint;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  SELECT COUNT(*) INTO v_total
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = v_org_id AND pe.stage_key = 'perdido'
    AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pe.created_at <= p_end_date);
  RETURN QUERY
  SELECT COALESCE(pe.metadata->>'loss_reason', 'Nao informado'),
    COUNT(*),
    COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0)::numeric,
    CASE WHEN v_total > 0 THEN ROUND(COUNT(*)::numeric / v_total * 100, 1) ELSE 0 END
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = v_org_id AND pe.stage_key = 'perdido'
    AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  GROUP BY pe.metadata->>'loss_reason'
  ORDER BY COUNT(*) DESC;
END; $$;

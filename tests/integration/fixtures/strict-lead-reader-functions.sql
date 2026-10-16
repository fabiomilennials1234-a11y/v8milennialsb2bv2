-- Production reader bodies captured 2026-10-13; these are exercised unchanged before/after migration.
CREATE OR REPLACE FUNCTION private.chat_scope_for_recipient(p_user_id uuid, p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_member_id uuid;
  v_restricted     boolean;
BEGIN
  IF public.is_master_user(p_user_id) THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO v_team_member_id
  FROM public.team_members
  WHERE user_id = p_user_id
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin') OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND role = 'admin' AND is_active) THEN RETURN true; END IF;

  SELECT chat_restrict_to_owner INTO v_restricted
  FROM public.organizations WHERE id = p_org_id;

  -- Politica desligada: comportamento identico ao de antes.
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;

  -- Excecao nominal: com a politica ligada o default_value do catalogo GLOBAL
  -- deixa de valer, so override EXPLICITO abre.
  IF EXISTS (
    SELECT 1 FROM public.member_feature_permissions
    WHERE team_member_id = v_team_member_id
      AND feature_key = 'leads.view_all'
      AND enabled
  ) THEN
    RETURN true;
  END IF;

  IF p_lead_id IS NULL AND p_normalized_phone IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND (
        (p_lead_id IS NOT NULL AND l.id = p_lead_id)
        OR (p_lead_id IS NULL AND l.normalized_phone = p_normalized_phone)
      )
      AND (
        COALESCE(
          v_team_member_id IN (
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ), false)
        OR (
          COALESCE(
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions
            WHERE team_member_id = v_team_member_id
              AND feature_key = 'leads.view_unassigned'
              AND enabled
          )
        )
      )
  );
END;
$function$

;
CREATE OR REPLACE FUNCTION public.get_funnel_health_stage_leads(p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_stage text, p_origins text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF p_stage NOT IN ('entraram', 'avaliados', 'bons', 'reuniao', 'compareceram', 'compraram') THEN
    RAISE EXCEPTION 'invalid_stage: %', p_stage USING ERRCODE = 'P0001';
  END IF;

  WITH cohort AS (
    SELECT l.id,
           l.name,
           l.company,
           l.created_at,
           COALESCE(l.qualification_tier, l.pre_qualification_tier) AS tier,
           COALESCE(l.pre_sale_responsible_id, l.sdr_id, l.responsible_id) AS tm_id
    FROM leads l
    WHERE l.organization_id = p_org_id
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_origins IS NULL OR cardinality(p_origins) = 0 OR l.origin::text = ANY(p_origins))
  ),
  meetings AS (
    SELECT me.lead_id,
           bool_or(me.event_type = 'meeting_booked') AS booked,
           bool_or(me.event_type = 'meeting_held') AS held,
           max(me.meeting_date) FILTER (WHERE me.event_type = 'meeting_booked') AS meeting_date,
           max(me.occurred_at) FILTER (WHERE me.event_type = 'meeting_held') AS held_at
    FROM meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.lead_id IN (SELECT id FROM cohort)
    GROUP BY me.lead_id
  ),
  propostas AS (
    -- entry mais recente do lead em Orçamentos (estado atual no funil de fechamento)
    SELECT DISTINCT ON (pe.lead_id)
           pe.lead_id,
           pe.stage_key AS proposta_stage,
           (pe.metadata ->> 'sale_value')::numeric AS sale_value
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system' -- metric-lint-allow: corpo reproduzido de prod (funnel_health), type=system pre-existente
    WHERE pe.organization_id = p_org_id
      AND pe.lead_id IN (SELECT id FROM cohort)
    ORDER BY pe.lead_id, pe.created_at DESC
  ),
  whatsapp_pos AS (
    -- posição atual no funil de Oportunidades (stage_key cru; o front humaniza)
    SELECT DISTINCT ON (pe.lead_id)
           pe.lead_id,
           pe.stage_key AS whatsapp_stage
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'whatsapp' AND pip.type = 'system' -- metric-lint-allow: corpo reproduzido de prod (funnel_health), type=system pre-existente
    WHERE pe.organization_id = p_org_id
      AND pe.lead_id IN (SELECT id FROM cohort)
    ORDER BY pe.lead_id, pe.created_at DESC
  ),
  enriched AS (
    SELECT c.*,
           w.whatsapp_stage,
           COALESCE(m.booked, false) AS booked,
           COALESCE(m.held, false) AS held,
           m.meeting_date,
           m.held_at,
           p.proposta_stage,
           p.sale_value,
           (p.proposta_stage = 'vendido') IS TRUE AS sold,
           tm.name AS pre_vendas
    FROM cohort c
    LEFT JOIN meetings m ON m.lead_id = c.id
    LEFT JOIN propostas p ON p.lead_id = c.id
    LEFT JOIN team_members tm ON tm.id = c.tm_id
    LEFT JOIN whatsapp_pos w ON w.lead_id = c.id
  ),
  filtered AS (
    SELECT *
    FROM enriched e
    WHERE CASE p_stage
      WHEN 'entraram' THEN true
      WHEN 'avaliados' THEN e.tier IS NOT NULL
      WHEN 'bons' THEN e.tier IN ('prata', 'ouro', 'diamante')
      WHEN 'reuniao' THEN e.booked
      WHEN 'compareceram' THEN e.held
      WHEN 'compraram' THEN e.sold
    END
    ORDER BY e.created_at DESC
    LIMIT 500
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'company', f.company,
        'tier', f.tier,
        'created_at', f.created_at,
        'pre_vendas', f.pre_vendas,
        'proposta_stage', f.proposta_stage,
        'sale_value', f.sale_value,
        'meeting_date', f.meeting_date,
        'held_at', f.held_at,
        'whatsapp_stage', f.whatsapp_stage
      )
      ORDER BY f.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM filtered f;

  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_lead_field_changes(p_lead_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, entity_type text, entity_id uuid, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, user_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    fc.id, fc.entity_type, fc.entity_id,
    fc.field_name, fc.old_value, fc.new_value,
    fc.changed_by, fc.changed_at,
    COALESCE(
      (SELECT tm.name FROM team_members tm WHERE tm.user_id = fc.changed_by LIMIT 1),
      'Sistema'
    ) AS user_name
  FROM field_changes fc
  WHERE fc.entity_id = p_lead_id
    AND fc.entity_type = 'lead'
    AND fc.organization_id IN (
      SELECT tm2.organization_id FROM team_members tm2 WHERE tm2.user_id = auth.uid()
    )
  ORDER BY fc.changed_at DESC
  LIMIT p_limit;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_leads_by_uf(p_uf character, p_limit integer DEFAULT 60, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, company text, phone text, uf_source text, is_client boolean, sold_value numeric, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT l.id, l.name, l.company, l.phone, l.uf_source,
    EXISTS (SELECT 1 FROM (SELECT np.*, np.stage_key AS status FROM public.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'),
    COALESCE((SELECT SUM(pp.sale_value) FROM (SELECT np.*, np.stage_key AS status FROM public.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'), 0)::numeric,
    l.created_at
  FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf
  ORDER BY 7 DESC, l.created_at DESC
  LIMIT p_limit;
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_next_best_actions(p_limit integer DEFAULT 10, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, lead_id uuid, lead_name text, deal_id uuid, action_type text, title text, reason text, priority integer, due_by timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH stored AS (
    SELECT nba.id, nba.lead_id, l.name, nba.deal_id, nba.action_type, nba.title, nba.reason, nba.priority, nba.due_by, nba.metadata
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
      'send_proposal'::text, ('Proposta parada há '||EXTRACT(DAY FROM now()-pp.stage_changed_at)::int||' dias')::text,
      ('Sem movimento desde '||to_char(pp.stage_changed_at,'DD/MM')||CASE WHEN COALESCE(pp.sale_value,0)>0 THEN ' — R$ '||to_char(pp.sale_value,'FM999G999G999')||' em jogo.' ELSE ' — retome o contato hoje.' END)::text,
      7, NULL::timestamptz, jsonb_build_object('derived',true,'source','negocio_projetado')
    FROM (SELECT np.*, np.stage_key AS status FROM public.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp LEFT JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = v_org_id AND pp.status NOT IN ('vendido','perdido') AND pp.stage_changed_at < now() - interval '7 days'
    ORDER BY COALESCE(pp.sale_value,0) DESC, pp.stage_changed_at ASC LIMIT 5
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
    SELECT md5('hl:'||l.id::text)::uuid, l.id, l.name, NULL::uuid,
      'call'::text, 'Resgatar lead quente parado'::text,
      ('Qualificação alta e sem movimento desde '||to_char(COALESCE(t.last_activity_at,l.created_at),'DD/MM')||' — um contato hoje mantém o lead vivo.')::text,
      5, NULL::timestamptz, jsonb_build_object('derived',true,'source','ultimo_toque')
    FROM leads l
    CROSS JOIN LATERAL (
      SELECT public._metric_ultimo_toque(v_org_id, l.id, NULL::timestamptz) AS last_activity_at
    ) t
    WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL
      AND (l.rating >= 4 OR l.qualification_score >= 70)
      AND COALESCE(t.last_activity_at,l.created_at) < now() - interval '48 hours'
      AND NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.lead_id = l.id AND fu.completed_at IS NULL AND fu.archived_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM (SELECT np.*, np.stage_key AS status FROM public.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')
    ORDER BY l.qualification_score DESC NULLS LAST, l.rating DESC NULLS LAST, COALESCE(t.last_activity_at,l.created_at) ASC
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_productivity_activity_leads(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_count_type text, p_seller uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF p_count_type = 'novos_leads' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   l.created_at
             ) AS r
      FROM public.leads l
      LEFT JOIN public.team_members tm ON tm.id = COALESCE(l.responsible_id, l.sdr_id)
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND l.created_at >= p_from
        AND l.created_at <= p_to
        AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller)
    ) q;

  ELSIF p_count_type = 'reunioes_marcadas' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   me.occurred_at
             ) AS r
      FROM public.meeting_events me
      JOIN public.leads l ON l.id = me.lead_id
      LEFT JOIN public.team_members tm ON tm.id = me.pre_sale_responsible_id
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_booked'
        AND me.occurred_at >= p_from
        AND me.occurred_at <= p_to
        AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller)
    ) q;

  ELSIF p_count_type = 'reunioes_realizadas' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   me.meeting_date
             ) AS r
      FROM public.meeting_events me
      JOIN public.leads l ON l.id = me.lead_id
      LEFT JOIN public.team_members tm ON tm.id = me.pre_sale_responsible_id
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_held'
        AND me.meeting_date IS NOT NULL
        AND me.meeting_date >= p_from
        AND me.meeting_date <= p_to
        AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller)
    ) q;

  ELSIF p_count_type = 'vendido' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     s.lead_id,
               'lead_name',   s.lead_name,
               'company',     s.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   s.sold_at
             ) AS r
      FROM (
        SELECT
          pe.lead_id,
          l.name    AS lead_name,
          l.company AS company,
          COALESCE(l.sale_responsible_id, l.closer_id, (pe.metadata->>'closer_id')::uuid) AS closer_id,
          COALESCE(
            (
              SELECT min(lh.created_at)
              FROM public.lead_history lh
              WHERE lh.lead_id = pe.lead_id
                AND lh.organization_id = p_org_id
                AND (
                     (lh.action = 'stage_changed' AND lh.metadata->>'to_stage' = 'vendido')
                  OR (lh.action = 'proposal_status_changed' AND lh.description ILIKE '%vendido%')
                )
            ),
            pe.closed_at,
            pe.stage_changed_at
          ) AS sold_at
        FROM public.pipeline_entries pe
        JOIN public.pipelines pip
          ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
        JOIN public.leads l
          ON l.id = pe.lead_id AND l.deleted_at IS NULL
        WHERE pe.organization_id = p_org_id
          AND pe.stage_key = 'vendido'
      ) s
      LEFT JOIN public.team_members tm ON tm.id = s.closer_id
      WHERE s.sold_at IS NOT NULL
        AND s.sold_at >= p_from
        AND s.sold_at <= p_to
        AND (p_seller IS NULL OR s.closer_id = p_seller)
    ) q;

  ELSE
    RAISE EXCEPTION 'invalid p_count_type: %', p_count_type USING ERRCODE = 'P0001';
  END IF;

  RETURN v_rows;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.search_messages(p_org_id uuid, p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, phone_number text, content text, direction text, "timestamp" timestamp with time zone, instance_id uuid, lead_id uuid, headline text, rank real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tsquery tsquery;
BEGIN
  -- ── Guard 1: autenticação ──────────────────────────────────────────────────
  -- auth.uid() retorna NULL quando não autenticado (service_role ou anon).
  -- Se chamado por service_role sem JWT, uid() = NULL — rejeitado aqui.
  -- Crons internos devem chamar via RPC com JWT válido ou não usar esta função.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied: authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Guard 2: pertencimento à org ───────────────────────────────────────────
  -- Verifica que o usuário é membro ativo da org requisitada.
  -- is_active = true: previne acesso por membros desativados.
  -- Isso impede que um membro de org A passe p_org_id de org B e veja mensagens.
  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id        = auth.uid()
      AND tm.organization_id = p_org_id
      AND tm.is_active       = true
  ) THEN
    RAISE EXCEPTION 'access_denied: user is not an active member of organization %', p_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Guard 3: query mínima ──────────────────────────────────────────────────
  -- Rejeitar queries vazias ou muito curtas que gerariam scan massivo.
  IF length(trim(coalesce(p_query, ''))) < 3 THEN
    RAISE EXCEPTION 'query_too_short: minimum 3 characters required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Guard 4: limit razoável ────────────────────────────────────────────────
  -- Proteger contra limit=999999 acidental ou malicioso.
  IF p_limit > 100 THEN
    RAISE EXCEPTION 'limit_too_large: maximum is 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Parsear query uma vez ──────────────────────────────────────────────────
  -- websearch_to_tsquery aceita sintaxe humana:
  --   "proposta OR contrato" → proposta | contrato
  --   "proposta contrato"    → proposta & contrato (AND implícito)
  --   '"proposta final"'     → frase exata
  -- Retorna NULL para query inválida (ex: query toda de stop words).
  -- Se NULL, não retornar resultados (não falhar).
  v_tsquery := websearch_to_tsquery('portuguese', p_query);

  IF v_tsquery IS NULL THEN
    RETURN;
  END IF;

  -- ── Query principal ────────────────────────────────────────────────────────
  RETURN QUERY
  SELECT
    m.id,
    m.phone_number,
    m.content,
    m.direction,
    m."timestamp",
    m.instance_id,
    m.lead_id,
    -- headline: fragmento com o termo destacado em <mark>...</mark>
    -- MaxWords/MinWords controlam o tamanho do snippet
    -- HighlightAll=false: não destacar cada ocorrência no texto completo
    ts_headline(
      'portuguese',
      coalesce(m.content, ''),
      v_tsquery,
      'StartSel=<mark>,StopSel=</mark>,MaxWords=20,MinWords=5,HighlightAll=false'
    ) AS headline,
    ts_rank(m.search_tsv, v_tsquery) AS rank
  FROM public.whatsapp_messages m
  WHERE m.organization_id = p_org_id
    AND m.search_tsv @@ v_tsquery
  ORDER BY
    ts_rank(m.search_tsv, v_tsquery) DESC,
    m."timestamp" DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assert_org_access(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- backend (service_role) e jobs internos passam
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;

  -- master vê qualquer org
  IF public.is_master_user() THEN RETURN; END IF;

  -- org nula nunca concede acesso
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  -- membro ATIVO da org, ou gestor de portfólio da org (ADR-0021).
  -- get_my_organization_ids() é a fonte única: team_members com
  -- is_active = true UNION get_my_gestor_organization_ids().
  IF EXISTS (
    SELECT 1 FROM public.get_my_organization_ids() AS t(org_id)
    WHERE t.org_id = p_org_id
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_org_for_rpc(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid;
BEGIN
  IF p_org_id IS NOT NULL THEN
    SELECT tm.organization_id INTO v FROM team_members tm
    WHERE tm.user_id = auth.uid() AND tm.organization_id = p_org_id LIMIT 1;
    RETURN v;
  END IF;
  SELECT tm.organization_id INTO v FROM team_members tm
  WHERE tm.user_id = auth.uid() LIMIT 1;
  RETURN v;
END; $function$
;
CREATE OR REPLACE FUNCTION public.pipeline_entries_snapshot_responsibles()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lead leads%ROWTYPE;
  v_slug text;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.slug INTO v_slug FROM pipelines p WHERE p.id = NEW.pipeline_id;
  IF v_slug IS DISTINCT FROM 'propostas' THEN RETURN NEW; END IF;

  IF COALESCE(
       NULLIF(NEW.metadata->>'sale_responsible_id', ''),
       NULLIF(NEW.metadata->>'pre_sale_responsible_id', ''),
       NULLIF(NEW.metadata->>'closer_id', ''),
       NULLIF(NEW.metadata->>'responsible_id', '')
     ) IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'sale_responsible_id',     COALESCE(v_lead.sale_responsible_id, v_lead.closer_id, v_lead.responsible_id),
    'pre_sale_responsible_id', COALESCE(v_lead.pre_sale_responsible_id, v_lead.sdr_id, v_lead.responsible_id),
    'closer_id',               v_lead.closer_id,
    'responsible_id',          v_lead.responsible_id
  ));
  RETURN NEW;
END;
$function$
;

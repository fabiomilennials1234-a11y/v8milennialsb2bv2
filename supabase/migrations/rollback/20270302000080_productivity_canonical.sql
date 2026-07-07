-- ROLLBACK de 20270302000080_productivity_canonical.sql (issue #1000)
--
-- Restaura os corpos LEGADOS (com R3/R4/R5 no bloco `vendido`) das três RPCs de
-- produtividade, idênticos às snapshots ADR-0018 (20270301000005/09/10) que
-- capturaram o corpo VIVO de prod. É um rollback de LEITURA puro: nenhuma tabela,
-- nenhum estado — só CREATE OR REPLACE de volta ao motor antigo. sale_events e o
-- resto do SP-3 permanecem intactos (o caderno segue existindo; só deixa de ser
-- lido pela produtividade).
--
-- Use antes do portão de reconciliação (#1000) fechar, se a leitura canônica de
-- vendido precisar ser revertida.

BEGIN;

-- ── get_productivity_activity (legado) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_productivity_activity(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_seller uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_novos       int := 0;
  v_marcadas    int := 0;
  v_realizadas  int := 0;
  v_vendido     int := 0;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  SELECT count(*) INTO v_novos
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.created_at >= p_from
    AND l.created_at <= p_to
    AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller);

  SELECT count(*) INTO v_marcadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.occurred_at >= p_from
    AND me.occurred_at <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  SELECT count(*) INTO v_realizadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_held'
    AND me.meeting_date IS NOT NULL
    AND me.meeting_date >= p_from
    AND me.meeting_date <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  SELECT count(*) INTO v_vendido
  FROM (
    SELECT
      pe.lead_id,
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
  WHERE s.sold_at IS NOT NULL
    AND s.sold_at >= p_from
    AND s.sold_at <= p_to
    AND (p_seller IS NULL OR s.closer_id = p_seller);

  RETURN jsonb_build_object(
    'novos_leads',         v_novos,
    'reunioes_marcadas',   v_marcadas,
    'reunioes_realizadas', v_realizadas,
    'vendido',             v_vendido,
    'from',                p_from,
    'to',                  p_to,
    'seller',              p_seller
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_productivity_activity(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productivity_activity(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- ── get_productivity_activity_leads (legado) ───────────────────────────────
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
$function$;

REVOKE ALL ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) TO authenticated, service_role;

-- ── get_productivity_activity_by_seller (legado) ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_productivity_activity_by_seller(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  WITH members AS (
    SELECT tm.id, tm.name, tm.metric_type::text AS metric_type
    FROM public.team_members tm
    WHERE tm.organization_id = p_org_id
      AND tm.is_active = true
  ),
  marcadas AS (
    SELECT me.pre_sale_responsible_id AS sid, count(*) AS c
    FROM public.meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_booked'
      AND me.occurred_at >= p_from AND me.occurred_at <= p_to
      AND me.pre_sale_responsible_id IS NOT NULL
    GROUP BY 1
  ),
  realizadas AS (
    SELECT me.pre_sale_responsible_id AS sid, count(*) AS c
    FROM public.meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND me.meeting_date IS NOT NULL
      AND me.meeting_date >= p_from AND me.meeting_date <= p_to
      AND me.pre_sale_responsible_id IS NOT NULL
    GROUP BY 1
  ),
  novos AS (
    SELECT COALESCE(l.responsible_id, l.sdr_id) AS sid, count(*) AS c
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_from AND l.created_at <= p_to
      AND COALESCE(l.responsible_id, l.sdr_id) IS NOT NULL
    GROUP BY 1
  ),
  vendido AS (
    SELECT s.closer_id AS sid, count(*) AS c
    FROM (
      SELECT
        pe.lead_id,
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
    WHERE s.sold_at IS NOT NULL
      AND s.sold_at >= p_from AND s.sold_at <= p_to
      AND s.closer_id IS NOT NULL
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(t)
      ORDER BY t.reunioes_realizadas DESC, t.reunioes_marcadas DESC, t.vendido DESC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM (
    SELECT
      m.id                        AS seller_id,
      m.name                      AS seller_name,
      m.metric_type               AS metric_type,
      COALESCE(n.c, 0)::int       AS novos_leads,
      COALESCE(mk.c, 0)::int      AS reunioes_marcadas,
      COALESCE(r.c, 0)::int       AS reunioes_realizadas,
      COALESCE(v.c, 0)::int       AS vendido
    FROM members m
    LEFT JOIN marcadas   mk ON mk.sid = m.id
    LEFT JOIN realizadas r  ON r.sid  = m.id
    LEFT JOIN novos      n  ON n.sid  = m.id
    LEFT JOIN vendido    v  ON v.sid  = m.id
    WHERE COALESCE(mk.c,0) + COALESCE(r.c,0) + COALESCE(v.c,0) + COALESCE(n.c,0) > 0
  ) t;

  RETURN result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_productivity_activity_by_seller(uuid, timestamptz, timestamptz) TO authenticated;

COMMIT;

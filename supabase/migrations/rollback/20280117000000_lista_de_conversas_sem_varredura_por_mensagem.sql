-- Rollback de 20280117000000_lista_de_conversas_sem_varredura_por_mensagem.
--
-- Devolve public.get_whatsapp_conversation_list_multi à definição que estava
-- VIVA em prod em 16/11/2026, lida com pg_get_functiondef (não do repo: o
-- corpo de prod tem os desvios jrtex_pipeline_scoped e
-- riofix_balcao_current_scope, que nenhuma migration do repo carrega).
-- Comentários longos do original foram encurtados; o código é o mesmo.

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list_multi(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false, p_before_box uuid DEFAULT NULL::uuid, p_before_phone text DEFAULT NULL::text)
 RETURNS TABLE(instance_id uuid, phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer, tags jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_boxes   uuid[];
  v_box_of    uuid[];
  v_member_of uuid[];
  v_members uuid[];
  v_keys    text[];
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
BEGIN
  IF private.jrtex_pipeline_scoped() THEN
    p_funnels := ARRAY(SELECT unnest(private.jrtex_visible_pipeline_ids()) INTERSECT SELECT unnest(coalesce(p_funnels, private.jrtex_visible_pipeline_ids())));
  END IF;
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);

  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(x.box ORDER BY x.member), array_agg(x.member ORDER BY x.member)
    INTO v_box_of, v_member_of
    FROM (
      SELECT DISTINCT ON (mm.member) b.box, mm.member
        FROM unnest(v_boxes) AS b(box)
        CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(p_org, b.box)) AS mm(member)
       ORDER BY mm.member, (mm.member = b.box) DESC, b.box
    ) x;

  IF v_member_of IS NULL THEN
    v_box_of    := v_boxes;
    v_member_of := v_boxes;
  END IF;

  v_members := v_member_of;
  v_keys    := ARRAY(SELECT t.m::text FROM unnest(v_members) AS t(m));

  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    v_iso_bypass :=
      public.is_org_admin(p_org)
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  IF private.riofix_balcao_current_scope() IS NOT NULL THEN
    v_iso_bypass:=true;
  END IF;
  RETURN QUERY
  WITH boxes AS (
    SELECT u.box, u.member
    FROM unnest(v_box_of, v_member_of) AS u(box, member)
  ),
  read_state AS (
    SELECT bx.box AS box,
           split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM private.conversation_read_state rs
    JOIN boxes bx ON bx.member::text = split_part(rs.conversation_key, ':', 2)
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1, 2
  ),
  conv AS (
    SELECT bx.box AS box, c.normalized_phone AS np, c.id, c.archived_at,
           c.deleted_at, c.instance_id AS inst, c.created_at
    FROM private.whatsapp_conversations c
    JOIN boxes bx ON bx.member = c.instance_id
    WHERE c.organization_id = p_org
      AND c.instance_id = ANY(v_members)
      AND c.normalized_phone IS NOT NULL
  ),
  conv_pick AS (
    SELECT DISTINCT ON (c2.box, c2.np)
           c2.box, c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.box, c2.np, (c2.inst = c2.box) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  chip AS (
    SELECT DISTINCT ON (bx.box, s.normalized_phone)
           bx.box AS box,
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id AS lid, s.is_group AS grp
    FROM private.whatsapp_conversation_summary s
    JOIN boxes bx ON bx.member = s.instance_id
    WHERE s.organization_id = p_org
      AND s.instance_id = ANY(v_members)
      AND (p_include_groups OR s.is_group = false)
      AND (
        v_iso_bypass
        OR (s.is_group AND COALESCE(v_iso_unassign, false))
        OR EXISTS (
          SELECT 1 FROM private.leads l
          WHERE l.organization_id  = p_org
            AND l.normalized_phone = s.normalized_phone
            AND l.deleted_at IS NULL
            AND (
              COALESCE(v_iso_tm IN (
                l.pre_sale_responsible_id, l.sale_responsible_id,
                l.sdr_id, l.closer_id
              ), false)
              OR COALESCE(v_iso_tm IS NOT NULL
                          AND public.rls_lead_co_owned(l.id, ARRAY[v_iso_tm]), false)
              OR (
                COALESCE(
                  l.pre_sale_responsible_id, l.sale_responsible_id,
                  l.sdr_id, l.closer_id
                ) IS NULL
                AND v_iso_unassign
              )
            )
        )
      )
    ORDER BY bx.box, s.normalized_phone, s.last_message_time DESC
  ),
  page AS (
    SELECT s.box, s.phone_number, s.normalized_phone, s.last_push_name,
           s.last_message, s.last_message_time, s.last_message_direction,
           s.last_message_sent_source, s.lid, s.grp
    FROM chip s
    WHERE (
        p_before IS NULL
        OR s.last_message_time < p_before
        OR (s.last_message_time = p_before
            AND (p_before_box IS NULL
                 OR p_before_phone IS NULL
                 OR (s.box, s.normalized_phone) < (p_before_box, p_before_phone)))
      )

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lid IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lid IS NULL)
      )

      AND (
        p_unread IS NOT TRUE
        OR public.is_conversation_marked_unread(p_org, s.box, s.normalized_phone)
        OR EXISTS (
             SELECT 1
             FROM private.whatsapp_messages m
             LEFT JOIN read_state r ON r.box = s.box AND r.np = s.normalized_phone
             WHERE m.organization_id  = p_org
               AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = s.box)
               AND m.normalized_phone = s.normalized_phone
               AND m.direction        = 'incoming'
               AND m.deleted_at IS NULL
               AND (p_include_groups OR m.is_group = false)
               AND m."timestamp" > now() - interval '30 days'
               AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
           )
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM private.conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lid
                AND cv.state = 'WAITING_HUMAN'))
      )

      AND (
        p_tiers IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM private.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lid IS NULL
        OR EXISTS (
              SELECT 1 FROM private.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM private.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM private.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM private.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      AND (
        p_tags IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM private.lead_tags lt
              WHERE lt.lead_id = s.lid AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN public.whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.box = s.box AND c3.np = s.normalized_phone
                AND ct.tag_id = ANY(p_tags))
      )
    ORDER BY s.last_message_time DESC, s.box DESC, s.normalized_phone DESC
    LIMIT v_limit
  )
  SELECT p.box, p.phone_number, p.normalized_phone, p.last_push_name, p.last_message,
         p.last_message_time, p.last_message_direction, p.last_message_sent_source,
         p.lid, p.grp, cp.id, cp.archived_at, GREATEST(COALESCE(u.cnt, 0)::integer, CASE WHEN public.is_conversation_marked_unread(p_org, p.box, p.normalized_phone) THEN 1 ELSE 0 END),
         et.etiquetas
  FROM page p
  LEFT JOIN conv_pick cp ON cp.box = p.box AND cp.np = p.normalized_phone
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM private.whatsapp_messages m
    LEFT JOIN read_state r ON r.box = p.box AND r.np = p.normalized_phone
    WHERE m.organization_id  = p_org
      AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = p.box)
      AND m.normalized_phone = p.normalized_phone
      AND m.direction        = 'incoming'
      AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
  ) u ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'color', x.color)
                       ORDER BY x.origem, x.name, x.id),
             '[]'::jsonb) AS etiquetas
    FROM (
      SELECT DISTINCT ON (t.id) t.id, t.name, t.color, e.origem
      FROM (
        SELECT lt.tag_id, 0 AS origem
        FROM private.lead_tags lt
        JOIN private.leads l ON l.id = lt.lead_id
        WHERE lt.lead_id = p.lid
          AND l.organization_id = p_org
          AND l.deleted_at IS NULL
        UNION ALL
        SELECT ct.tag_id, 1
        FROM public.whatsapp_conversation_tags ct
        WHERE ct.conversation_id = cp.id
      ) e
      JOIN public.tags t ON t.id = e.tag_id AND t.organization_id = p_org
      ORDER BY t.id, e.origem
    ) x
  ) et ON true
  WHERE cp.deleted_at IS NULL
  ORDER BY p.last_message_time DESC, p.box DESC, p.normalized_phone DESC;
END;
$function$;

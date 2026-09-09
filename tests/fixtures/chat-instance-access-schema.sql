-- Production RPC definitions captured 2026-09-09; isolated schema and synthetic data.

CREATE SCHEMA chat_access_test;
CREATE SCHEMA chat_access_private_test;
GRANT USAGE ON SCHEMA chat_access_test TO authenticated, service_role;
GRANT USAGE ON SCHEMA chat_access_private_test TO authenticated;
SET LOCAL search_path = chat_access_test, public;
CREATE TABLE organizations(id uuid PRIMARY KEY, chat_restrict_to_owner boolean DEFAULT false);
CREATE TABLE team_members(id uuid, user_id uuid, organization_id uuid, is_active boolean, role text);
CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=chat_access_test AS $$ SELECT organization_id FROM team_members WHERE user_id=auth.uid() AND is_active $$;
CREATE FUNCTION is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='00000000-0000-0000-0000-000000000009'::uuid $$;
CREATE FUNCTION is_user_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=chat_access_test AS $$ SELECT EXISTS(SELECT FROM team_members WHERE user_id=auth.uid() AND role='admin' AND is_active) $$;
CREATE FUNCTION is_org_admin(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=chat_access_test AS $$ SELECT is_master_user() OR EXISTS(SELECT FROM team_members WHERE user_id=auth.uid() AND organization_id=$1 AND role='admin' AND is_active) $$;
CREATE FUNCTION my_team_member_id(uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=chat_access_test AS $$ SELECT id FROM team_members WHERE user_id=auth.uid() AND organization_id=$1 AND is_active LIMIT 1 $$;
CREATE FUNCTION can_see_chat_scope(uuid,uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION can_link_or_read_lead(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION normalize_brazilian_phone(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION is_conversation_marked_unread(uuid,uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE whatsapp_instances(id uuid PRIMARY KEY, organization_id uuid, phone_number text);
CREATE TABLE whatsapp_instance_allowed_members(whatsapp_instance_id uuid,team_member_id uuid);
CREATE TABLE whatsapp_instance_reap_queue(instance_id uuid,organization_id uuid,phone_number text);
CREATE TABLE conversation_read_state(organization_id uuid,user_id uuid,conversation_key text,last_read_at timestamptz);
CREATE TABLE whatsapp_messages(organization_id uuid,instance_id uuid,normalized_phone text,direction text,deleted_at timestamptz,is_group boolean DEFAULT false,timestamp timestamptz);
CREATE TABLE whatsapp_conversations(id uuid,organization_id uuid,instance_id uuid,normalized_phone text,archived_at timestamptz,deleted_at timestamptz,created_at timestamptz);
CREATE TABLE whatsapp_conversation_summary(organization_id uuid,instance_id uuid,normalized_phone text,phone_number text,last_push_name text,last_message text,last_message_time timestamptz,last_message_direction text,last_message_sent_source text,lead_id uuid,is_group boolean DEFAULT false);
CREATE TABLE leads(id uuid,organization_id uuid,normalized_phone text,deleted_at timestamptz,pre_sale_responsible_id uuid,sale_responsible_id uuid,sdr_id uuid,closer_id uuid,responsible_id uuid,qualification_tier text,name text,created_at timestamptz);
CREATE TABLE member_feature_permissions(team_member_id uuid,feature_key text,enabled boolean);
CREATE TABLE conversations(organization_id uuid,lead_id uuid,state text);
CREATE TABLE pipeline_entries(organization_id uuid,lead_id uuid,pipeline_id uuid,stage_key text);
CREATE TABLE lead_tags(lead_id uuid,tag_id uuid);
CREATE TABLE whatsapp_conversation_tags(conversation_id uuid,tag_id uuid);
CREATE TABLE channel_messages(organization_id uuid,instance_id uuid,contact_external_id text,content text,timestamp timestamptz,direction text,sender_name text,sender_profile_pic text,contact_handle text);
GRANT SELECT ON ALL TABLES IN SCHEMA chat_access_test TO authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_messages','whatsapp_conversations','whatsapp_conversation_summary','channel_messages'] LOOP
    EXECUTE format('ALTER TABLE chat_access_test.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_access ON chat_access_test.%I FOR SELECT TO authenticated USING (organization_id IN (SELECT chat_access_test.get_my_organization_ids()) OR chat_access_test.is_master_user())',t);
  END LOOP;
END $$;
INSERT INTO organizations VALUES ('10000000-0000-0000-0000-000000000001',false),('10000000-0000-0000-0000-000000000002',false);
INSERT INTO team_members SELECT ('00000000-0000-0000-0000-00000000000'||n)::uuid,('00000000-0000-0000-0000-00000000000'||n)::uuid,
'10000000-0000-0000-0000-000000000001',n<>4,CASE WHEN n=3 THEN 'admin' ELSE 'member' END FROM generate_series(1,4) n;
INSERT INTO team_members VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002',true,'admin');
INSERT INTO whatsapp_instances VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','5548999990001'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','5548999990002');
INSERT INTO whatsapp_instance_allowed_members VALUES
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
INSERT INTO whatsapp_instance_reap_queue VALUES
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','5548999990001');
INSERT INTO whatsapp_messages SELECT '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'48988880000','incoming',NULL,false,now() FROM generate_series(1,4) n;
INSERT INTO whatsapp_conversation_summary SELECT organization_id,instance_id,normalized_phone,normalized_phone,'Contact','Test message',timestamp,direction,NULL,NULL,false FROM whatsapp_messages;
INSERT INTO whatsapp_conversations SELECT instance_id,organization_id,instance_id,normalized_phone,NULL,NULL,now() FROM whatsapp_messages;
INSERT INTO channel_messages SELECT organization_id,instance_id,normalized_phone,'Test message',timestamp,direction,'Contact',NULL,NULL FROM whatsapp_messages;
CREATE OR REPLACE FUNCTION chat_access_test.get_official_whatsapp_conversation_list(p_org uuid, p_instance uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(contact_external_id text, sender_name text, sender_profile_pic text, contact_handle text, last_message text, last_message_time timestamp with time zone, last_message_direction text, unread_count integer, lead_id uuid, lead_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'chat_access_test'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM chat_access_test.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_access_test.whatsapp_instances wi
     WHERE wi.id = p_instance AND wi.organization_id = p_org
  ) THEN
    RAISE EXCEPTION 'forbidden: instance not in org' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH thread AS (
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.content              AS body,
           m."timestamp"          AS ts,
           m.direction            AS dir
      FROM chat_access_test.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.sender_name          AS s_name,
           m.sender_profile_pic   AS s_pic,
           m.contact_handle       AS s_handle
      FROM chat_access_test.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    SELECT m.contact_external_id AS cid, count(*)::integer AS cnt
      FROM chat_access_test.channel_messages m
      LEFT JOIN chat_access_test.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'whatsapp_oficial:' || p_instance::text
                                      || ':' || m.contact_external_id
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
       AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
     GROUP BY m.contact_external_id
  )
  SELECT t.cid,
         ci.s_name,
         ci.s_pic,
         ci.s_handle,
         t.body,
         t.ts,
         t.dir,
         COALESCE(u.cnt, 0)::integer,
         l.id,
         l.name
    FROM thread t
    LEFT JOIN contact_identity ci ON ci.cid = t.cid
    LEFT JOIN unread u            ON u.cid  = t.cid
    LEFT JOIN LATERAL (
      SELECT l2.id, l2.name
        FROM chat_access_test.leads l2
       WHERE l2.organization_id  = p_org
         AND l2.deleted_at IS NULL
         AND l2.normalized_phone = chat_access_test.normalize_brazilian_phone(t.cid)
         AND chat_access_test.can_link_or_read_lead(l2.id, p_org)
       ORDER BY l2.created_at NULLS LAST, l2.id
       LIMIT 1
    ) l ON true
   WHERE (p_before IS NULL OR t.ts < p_before)
     AND chat_access_test.can_see_chat_scope(p_org, NULL, chat_access_test.normalize_brazilian_phone(t.cid))
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION chat_access_test.get_whatsapp_conversation_list(p_org uuid, p_instance uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false)
 RETURNS TABLE(phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'chat_access_test'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_ids uuid[];
  v_iso_on        boolean;
  v_iso_bypass    boolean;
  v_iso_tm        uuid;
  v_iso_unassign  boolean;
  v_keys text[];
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM chat_access_test.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;
  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  v_ids  := whatsapp_chip_instance_ids(p_org, p_instance);
  v_keys := ARRAY(SELECT t.id::text FROM unnest(v_ids) AS t(id));

  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM chat_access_test.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM chat_access_test.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    v_iso_bypass :=
      chat_access_test.is_master_user()
      OR chat_access_test.is_user_admin()
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM chat_access_test.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM chat_access_test.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  RETURN QUERY
  WITH read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1
  ),
  unread AS (
    SELECT m.normalized_phone AS np, count(*)::integer AS cnt
    FROM whatsapp_messages m
    LEFT JOIN read_state r ON r.np = m.normalized_phone
    WHERE m.organization_id = p_org AND m.instance_id = ANY(v_ids)
      AND m.direction = 'incoming' AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
    GROUP BY m.normalized_phone
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at,
           c.instance_id, c.created_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = ANY(v_ids)
      AND c.normalized_phone IS NOT NULL
  ),
  conv_pick AS (
    SELECT DISTINCT ON (c2.np) c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.np, (c2.instance_id = p_instance) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  chip AS (
    SELECT DISTINCT ON (s.normalized_phone)
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = ANY(v_ids)
      AND (p_include_groups OR s.is_group = false)
      AND (
        v_iso_bypass
        OR (s.is_group AND COALESCE(v_iso_unassign, false))
        OR EXISTS (
          SELECT 1 FROM chat_access_test.leads l
          WHERE l.organization_id  = p_org
            AND l.normalized_phone = s.normalized_phone
            AND l.deleted_at IS NULL
            AND (
              COALESCE(v_iso_tm IN (
                l.pre_sale_responsible_id, l.sale_responsible_id,
                l.sdr_id, l.closer_id
              ), false)
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
    ORDER BY s.normalized_phone, s.last_message_time DESC
  ),
  page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
    FROM chip s
    WHERE (p_before IS NULL OR s.last_message_time < p_before)

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lead_id IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lead_id IS NULL)
      )

      AND (
        p_unread IS NOT TRUE
        OR chat_access_test.is_conversation_marked_unread(p_org, p_instance, s.normalized_phone)
        OR EXISTS (SELECT 1 FROM unread u WHERE u.np = s.normalized_phone AND u.cnt > 0)
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lead_id
                AND cv.state = 'WAITING_HUMAN'))
      )

      AND (
        p_tiers IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lead_id IS NULL
        OR EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      AND (
        p_tags IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM lead_tags lt
              WHERE lt.lead_id = s.lead_id AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.np = s.normalized_phone AND ct.tag_id = ANY(p_tags))
      )
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  )
  SELECT p.phone_number, p.normalized_phone, p.last_push_name, p.last_message, p.last_message_time,
         p.last_message_direction, p.last_message_sent_source, p.lead_id, p.is_group,
         conv.id, conv.archived_at, GREATEST(coalesce(u.cnt, 0), CASE WHEN chat_access_test.is_conversation_marked_unread(p_org, p_instance, p.normalized_phone) THEN 1 ELSE 0 END)
  FROM page p
  LEFT JOIN conv_pick conv ON conv.np = p.normalized_phone
  LEFT JOIN unread u ON u.np  = p.normalized_phone
  WHERE conv.deleted_at IS NULL
  ORDER BY p.last_message_time DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION chat_access_test.whatsapp_chip_instance_ids(p_org uuid, p_instance uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'chat_access_test'
AS $function$
DECLARE
  v_digits text;
  v_ids    uuid[];
BEGIN
  IF p_org IS NULL
     OR (COALESCE(auth.role(), '') <> 'service_role'
         AND NOT EXISTS (
               SELECT 1 FROM chat_access_test.get_my_organization_ids() AS g(org_id)
                WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false))
  THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  SELECT regexp_replace(w.phone_number, '[^0-9]', '', 'g')
    INTO v_digits
    FROM chat_access_test.whatsapp_instances w
   WHERE w.id = p_instance
     AND w.organization_id = p_org;

  IF v_digits IS NULL OR length(v_digits) < 10 THEN
    RETURN ARRAY[p_instance];
  END IF;

  SELECT array_agg(DISTINCT s.id)
    INTO v_ids
    FROM (
      SELECT p_instance AS id
      UNION
      SELECT q.instance_id
        FROM chat_access_test.whatsapp_instance_reap_queue q
       WHERE q.organization_id = p_org
         AND q.phone_number IS NOT NULL
         AND regexp_replace(q.phone_number, '[^0-9]', '', 'g') = v_digits
    ) s;

  RETURN COALESCE(v_ids, ARRAY[p_instance]);
END;
$function$;
CREATE OR REPLACE FUNCTION chat_access_test.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'chat_access_test'
AS $function$
DECLARE
  v_bypass boolean;
  v_tm     uuid;
  v_out    uuid[];
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM chat_access_test.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  v_bypass := COALESCE(chat_access_test.is_org_admin(p_org), false);
  v_tm     := chat_access_test.my_team_member_id(p_org);

  SELECT array_agg(wi.id ORDER BY wi.id)
    INTO v_out
    FROM chat_access_test.whatsapp_instances wi
   WHERE wi.organization_id = p_org
     AND (p_instances IS NULL
          OR cardinality(p_instances) = 0
          OR wi.id = ANY(p_instances))
     AND (
       v_bypass
       OR NOT EXISTS (
            SELECT 1 FROM chat_access_test.whatsapp_instance_allowed_members a
             WHERE a.whatsapp_instance_id = wi.id)
       OR (v_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM chat_access_test.whatsapp_instance_allowed_members a
             WHERE a.whatsapp_instance_id = wi.id
               AND a.team_member_id = v_tm))
     );

  RETURN COALESCE(v_out, ARRAY[]::uuid[]);
END;
$function$;

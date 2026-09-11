-- Enforce the instance allowlist on single-box RPCs and direct chat reads.
-- Preserve organization-admin/master access and the existing open-box semantics.
-- The QR single-box RPC already resolves whatsapp_chip_instance_ids before reading.
-- Replacing that resolver closes both the list and historical-ID endpoints.
CREATE OR REPLACE FUNCTION public.whatsapp_chip_instance_ids(p_org uuid, p_instance uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text;
  v_ids    uuid[];
BEGIN
  IF p_org IS NULL
     OR (COALESCE(auth.role(), '') <> 'service_role'
         AND NOT EXISTS (
               SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
                WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false))
  THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- A live box must be readable before resolving any of its historical IDs.
  -- Server-side delivery/history workers retain their existing service access.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT COALESCE(p_instance = ANY(
       public.whatsapp_readable_instance_ids(p_org, ARRAY[p_instance])
     ), false) THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT regexp_replace(w.phone_number, '[^0-9]', '', 'g')
    INTO v_digits
    FROM public.whatsapp_instances w
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
        FROM public.whatsapp_instance_reap_queue q
       WHERE q.organization_id = p_org
         AND q.phone_number IS NOT NULL
         AND regexp_replace(q.phone_number, '[^0-9]', '', 'g') = v_digits
    ) s;

  RETURN COALESCE(v_ids, ARRAY[p_instance]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_official_whatsapp_conversation_list(p_org uuid, p_instance uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(contact_external_id text, sender_name text, sender_profile_pic text, contact_handle text, last_message text, last_message_time timestamp with time zone, last_message_direction text, unread_count integer, lead_id uuid, lead_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_instances wi
     WHERE wi.id = p_instance AND wi.organization_id = p_org
  ) THEN
    RAISE EXCEPTION 'forbidden: instance not in org' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(p_instance = ANY(
    public.whatsapp_readable_instance_ids(p_org, ARRAY[p_instance])
  ), false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH thread AS (
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.content              AS body,
           m."timestamp"          AS ts,
           m.direction            AS dir
      FROM public.channel_messages m
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
      FROM public.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    SELECT m.contact_external_id AS cid, count(*)::integer AS cnt
      FROM public.channel_messages m
      LEFT JOIN public.conversation_read_state rs
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
        FROM public.leads l2
       WHERE l2.organization_id  = p_org
         AND l2.deleted_at IS NULL
         AND l2.normalized_phone = public.normalize_brazilian_phone(t.cid)
         AND public.can_link_or_read_lead(l2.id, p_org)
       ORDER BY l2.created_at NULLS LAST, l2.id
       LIMIT 1
    ) l ON true
   WHERE (p_before IS NULL OR t.ts < p_before)
     AND public.can_see_chat_scope(p_org, NULL, public.normalize_brazilian_phone(t.cid))
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- No caller-supplied user/org: derive the accessible live boxes from auth.uid(),
-- then expand only their chip history. RLS evaluates this once per statement.
CREATE OR REPLACE FUNCTION private.whatsapp_readable_message_instance_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT history.id), ARRAY[]::uuid[])
  FROM public.get_my_organization_ids() AS org(id)
  CROSS JOIN LATERAL unnest(public.whatsapp_readable_instance_ids(org.id)) AS box(id)
  CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(org.id, box.id)) AS history(id)
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.whatsapp_readable_message_instance_ids() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.whatsapp_readable_message_instance_ids() TO authenticated;

-- Restrictive policies intersect every existing permissive SELECT policy.
-- Admins retain orphaned history too; members only see allowed live boxes/history.

CREATE POLICY whatsapp_messages_instance_read_access
ON public.whatsapp_messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  (SELECT public.is_master_user())
  OR organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active AND tm.role = 'admin'
  )
  OR instance_id = ANY ((SELECT private.whatsapp_readable_message_instance_ids())::uuid[])
);

CREATE POLICY whatsapp_conversation_summary_instance_read_access
ON public.whatsapp_conversation_summary AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  (SELECT public.is_master_user())
  OR organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active AND tm.role = 'admin'
  )
  OR instance_id = ANY ((SELECT private.whatsapp_readable_message_instance_ids())::uuid[])
);

CREATE POLICY whatsapp_conversations_instance_read_access
ON public.whatsapp_conversations AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  (SELECT public.is_master_user())
  OR organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active AND tm.role = 'admin'
  )
  OR instance_id = ANY ((SELECT private.whatsapp_readable_message_instance_ids())::uuid[])
);

CREATE POLICY channel_messages_instance_read_access
ON public.channel_messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  (SELECT public.is_master_user())
  OR organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active AND tm.role = 'admin'
  )
  OR instance_id IS NULL -- Social channels have their own access rules.
  OR instance_id = ANY ((SELECT private.whatsapp_readable_message_instance_ids())::uuid[])
);

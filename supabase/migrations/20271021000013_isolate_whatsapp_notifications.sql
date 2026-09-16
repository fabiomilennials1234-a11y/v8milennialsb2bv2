CREATE OR REPLACE FUNCTION private.chat_scope_for_recipient(
  p_user_id uuid,
  p_org_id           uuid,
  p_lead_id          uuid,
  p_normalized_phone text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.chat_scope_for_recipient(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
-- Only trusted definers below can evaluate another recipient's scope.
CREATE OR REPLACE FUNCTION public.can_see_chat_scope(p_org_id uuid,p_lead_id uuid,p_normalized_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone);
$$;
REVOKE ALL ON FUNCTION public.can_see_chat_scope(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_see_chat_scope(uuid,uuid,text) TO authenticated,service_role;

-- Members require an explicit number assignment. Lead ownership never grants
-- access to another seller's WhatsApp previews. Existing admin/master management
-- access remains; notifications are delivered only to explicitly linked users.
CREATE OR REPLACE FUNCTION public.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[] DEFAULT NULL)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS NULL OR (NOT EXISTS (
    SELECT 1 FROM public.get_my_organization_ids() g(id) WHERE g.id = p_org
  ) AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  RETURN ARRAY(
    SELECT wi.id FROM public.whatsapp_instances wi
    WHERE wi.organization_id = p_org
      AND (p_instances IS NULL OR cardinality(p_instances) = 0 OR wi.id = ANY(p_instances))
      AND (COALESCE(public.is_master_user(), false) OR COALESCE(public.is_org_admin(p_org), false)
        OR EXISTS (
          SELECT 1 FROM public.whatsapp_instance_allowed_members a
          JOIN public.team_members tm ON tm.id = a.team_member_id
          WHERE a.whatsapp_instance_id = wi.id AND tm.organization_id = p_org
            AND tm.user_id = auth.uid() AND tm.is_active
        )) ORDER BY wi.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.whatsapp_visible_instance_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(box.id), ARRAY[]::uuid[])
  FROM public.get_my_organization_ids() org(id)
  CROSS JOIN LATERAL unnest(public.whatsapp_readable_instance_ids(org.id)) box(id)
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.whatsapp_visible_instance_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.whatsapp_visible_instance_ids() TO authenticated;

CREATE POLICY whatsapp_instances_linked_read ON public.whatsapp_instances
AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (SELECT public.is_master_user())
  OR id = ANY((SELECT private.whatsapp_visible_instance_ids())::uuid[])
);

-- Historical notifications lack trustworthy instance provenance (one lead could
-- coalesce messages from several numbers). Keep them stored, but fail closed.
ALTER TABLE public.notifications ADD COLUMN whatsapp_instance_id uuid, ADD COLUMN whatsapp_phone text;
COMMENT ON COLUMN public.notifications.whatsapp_instance_id IS
  'Originating WhatsApp number for message notifications. NULL legacy previews are not exposed.';

CREATE OR REPLACE FUNCTION private.whatsapp_notification_instance_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(DISTINCT wi.id), ARRAY[]::uuid[])
  FROM public.whatsapp_instance_allowed_members a
  JOIN public.whatsapp_instances wi ON wi.id = a.whatsapp_instance_id
  JOIN public.team_members tm ON tm.id = a.team_member_id AND tm.organization_id = wi.organization_id
  WHERE tm.user_id = auth.uid() AND tm.is_active;
$$;
REVOKE ALL ON FUNCTION private.whatsapp_notification_instance_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.whatsapp_notification_instance_ids() TO authenticated;

CREATE POLICY notifications_whatsapp_scope ON public.notifications
AS RESTRICTIVE FOR SELECT TO authenticated USING (
  type <> 'lead_message'
  OR (SELECT public.is_master_user())
  OR (organization_id IN (SELECT public.get_my_organization_ids())
      AND whatsapp_instance_id = ANY((SELECT private.whatsapp_notification_instance_ids())::uuid[])
      AND public.can_see_chat_scope(organization_id,lead_id,whatsapp_phone))
);

CREATE OR REPLACE FUNCTION public.fn_aviso_de_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_name text;
  v_phone text;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'incoming' OR NEW.instance_id IS NULL
    OR COALESCE(NEW.is_group, false) OR COALESCE(NEW.sent_by_ai, false)
    OR NEW.received_via = 'history_sync' THEN RETURN NEW; END IF;
  v_phone := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF v_phone = '' THEN RETURN NEW; END IF;
  SELECT name INTO v_name FROM public.leads
    WHERE id = NEW.lead_id AND organization_id = NEW.organization_id;

  FOR v_user IN
    SELECT DISTINCT tm.user_id
    FROM public.whatsapp_instance_allowed_members a
    JOIN public.whatsapp_instances wi ON wi.id = a.whatsapp_instance_id
    JOIN public.team_members tm ON tm.id = a.team_member_id
    WHERE wi.id = NEW.instance_id AND wi.organization_id = NEW.organization_id
      AND tm.organization_id = NEW.organization_id AND tm.is_active AND tm.user_id IS NOT NULL
      AND private.chat_scope_for_recipient(tm.user_id,NEW.organization_id,NEW.lead_id,public.normalize_brazilian_phone(v_phone))
  LOOP
    INSERT INTO public.notifications AS n (
      organization_id, user_id, type, title, description, link, lead_id,
      entity_id, group_key, event_count, last_event_at, whatsapp_instance_id, whatsapp_phone
    ) VALUES (
      NEW.organization_id, v_user, 'lead_message',
      COALESCE(NULLIF(v_name, ''), NULLIF(NEW.push_name, ''), v_phone),
      left(COALESCE(NEW.content, ''), 140),
      '/chat-whatsapp?instance=' || NEW.instance_id::text || '&phone=' || v_phone,
      NEW.lead_id, NEW.lead_id,
      'msg:' || NEW.organization_id::text || ':' || NEW.instance_id::text || ':' || v_phone,
      1, COALESCE(NEW.timestamp, now()), NEW.instance_id, public.normalize_brazilian_phone(v_phone)
    ) ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL
    DO UPDATE SET event_count = n.event_count + 1,
      last_event_at = GREATEST(n.last_event_at, EXCLUDED.last_event_at),
      title = EXCLUDED.title, description = EXCLUDED.description, link = EXCLUDED.link,
      lead_id = EXCLUDED.lead_id, entity_id = EXCLUDED.entity_id, whatsapp_phone = EXCLUDED.whatsapp_phone;
  END LOOP;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.fn_aviso_de_mensagem() IS
  'Inbound WhatsApp notifications belong to linked number users, grouped by org/number/contact, including conversations without leads.';
-- Trigger-only entry point; no client needs to invoke this definer as an RPC.
REVOKE ALL ON FUNCTION public.fn_aviso_de_mensagem() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_avisos_pendentes_de_push(
  p_janela_de_presenca interval DEFAULT interval '2 minutes',
  p_idade_maxima       interval DEFAULT interval '15 minutes',
  p_limite             integer  DEFAULT 200
)
RETURNS TABLE (
  aviso_id        uuid,
  user_id         uuid,
  organization_id uuid,
  type            text,
  title           text,
  description     text,
  link            text,
  group_key       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id, n.user_id, n.organization_id, n.type, n.title, n.description, n.link, n.group_key
    FROM public.notifications n
   WHERE n.pushed_at IS NULL
     AND n.read_at IS NULL
     -- The worker uses service_role: re-check recipient access despite RLS.
     AND (n.type <> 'lead_message' OR EXISTS (
       SELECT 1 FROM public.whatsapp_instance_allowed_members a
       JOIN public.whatsapp_instances wi ON wi.id = a.whatsapp_instance_id
       JOIN public.team_members tm ON tm.id = a.team_member_id
       WHERE wi.id = n.whatsapp_instance_id AND wi.organization_id = n.organization_id
         AND tm.organization_id = n.organization_id AND tm.user_id = n.user_id AND tm.is_active
         AND private.chat_scope_for_recipient(n.user_id,n.organization_id,n.lead_id,n.whatsapp_phone)
     ))
     -- Só o canal quente. Agenda e sistema ficam no sino.
     AND n.type IN ('lead_message', 'transfer_to_human', 'lead_new', 'workflow_alert', 'cron_drift')
     -- Backlog velho não vira enxurrada de push quando o cron volta a rodar.
     AND n.created_at > now() - p_idade_maxima
     AND (public.fn_preferencias_de_aviso(n.user_id, n.organization_id) ->> 'push_enabled')::boolean
     AND NOT EXISTS (
       SELECT 1 FROM public.user_presence p
        WHERE p.user_id = n.user_id
          AND p.organization_id = n.organization_id
          AND p.last_seen_at > now() - p_janela_de_presenca
     )
     AND EXISTS (
       SELECT 1 FROM public.push_subscriptions s
        WHERE s.user_id = n.user_id
     )
   ORDER BY n.created_at
   LIMIT p_limite;
$$;


-- Keep provider-proxy reads inside the same number boundary.
CREATE OR REPLACE FUNCTION public.can_see_chat_target(
  p_org_id      uuid,
  p_lead_id     uuid    DEFAULT NULL,
  p_raw_phone   text    DEFAULT NULL,
  p_message_id  text    DEFAULT NULL,
  p_instance_id uuid    DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid := p_lead_id;
  v_phone   text;
BEGIN
  IF p_org_id IS NULL THEN RETURN false; END IF;

  -- The provider proxy also uses this RPC for media/history actions. Enforce
  -- number access before the lead/phone scope, which alone is insufficient when
  -- the same customer is handled by multiple sellers.
  IF p_instance_id IS NOT NULL THEN
    IF NOT COALESCE(p_instance_id = ANY(public.whatsapp_readable_instance_ids(p_org_id, ARRAY[p_instance_id])), false) THEN
      RETURN false;
    END IF;
  ELSIF NOT (COALESCE(public.is_master_user(), false) OR COALESCE(public.is_org_admin(p_org_id), false)) THEN
    RETURN false;
  END IF;

  -- Sem chave nenhuma: a acao nao toca conversa (getStatus, connectQR,
  -- logoutInstance, getMessageLimits...). Nao e o gate que decide isso, mas
  -- devolver true aqui e o comportamento correto: nao ha conversa a proteger.
  IF p_lead_id IS NULL AND p_raw_phone IS NULL AND p_message_id IS NULL THEN
    RETURN true;
  END IF;

  IF p_raw_phone IS NOT NULL THEN
    -- Aceita numero puro e JID (5511999990001@s.whatsapp.net / @g.us).
    v_phone := public.normalize_brazilian_phone(split_part(p_raw_phone, '@', 1));
  END IF;

  -- message_id sem telefone: markRead e downloadMedia mandam so o id. A linha
  -- e lida por SECURITY DEFINER de proposito -- o usuario nao a enxerga.
  IF v_phone IS NULL AND v_lead_id IS NULL AND p_message_id IS NOT NULL THEN
    SELECT m.normalized_phone, m.lead_id
      INTO v_phone, v_lead_id
    FROM public.whatsapp_messages m
    WHERE m.message_id = p_message_id
      AND m.organization_id = p_org_id
      AND (p_instance_id IS NULL OR m.instance_id = p_instance_id)
    LIMIT 1;

    -- message_id que nao existe nesta org: nao ha alvo legitimo. Fail-closed.
    IF v_phone IS NULL AND v_lead_id IS NULL THEN RETURN false; END IF;
  END IF;

  RETURN public.can_see_chat_scope(p_org_id, v_lead_id, v_phone);
END;
$$;


-- Copilot sessions are keyed by lead/agent, not number, and can mix origins.
-- Do not infer provenance from the agent's current number or the lead owner.
-- Members use the original, instance-scoped WhatsApp history instead.
CREATE OR REPLACE FUNCTION private.can_read_aggregate_conversation(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.conversations c
   WHERE c.id=p_id AND (public.is_master_user() OR (
     c.organization_id IN (SELECT public.get_my_organization_ids())
     AND public.is_org_admin(c.organization_id)
   ))
 );
$$;
REVOKE ALL ON FUNCTION private.can_read_aggregate_conversation(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.can_read_aggregate_conversation(uuid) TO authenticated;
-- Operational state remains available, but JSON memories have mixed origins.
-- Column grants preserve the existing state readers and FSM updates without
-- permitting SELECT * (or a direct REST request for memories) to leak content.
REVOKE SELECT ON public.conversations FROM PUBLIC,anon,authenticated;
REVOKE SELECT (context,short_term_memory,long_term_memory) ON public.conversations FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,lead_id,organization_id,agent_id,state,turn_count,last_message_at,
 created_at,updated_at,assigned_to,ai_state,ai_state_resume_mode,ai_state_updated_at,
 ai_state_updated_by,human_paused_until) ON public.conversations TO authenticated;
CREATE OR REPLACE FUNCTION private.can_read_conversation_state(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.conversations c
   WHERE c.id=p_id AND (public.is_master_user() OR (
     c.organization_id IN (SELECT public.get_my_organization_ids())
     AND public.can_see_chat_scope(c.organization_id,c.lead_id,NULL)
     AND (public.is_org_admin(c.organization_id) OR EXISTS (
       SELECT 1 FROM public.whatsapp_messages m
       WHERE m.organization_id=c.organization_id AND m.lead_id=c.lead_id
         AND m.instance_id=ANY(private.whatsapp_readable_message_instance_ids())
     ))
   ))
 );
$$;
REVOKE ALL ON FUNCTION private.can_read_conversation_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.can_read_conversation_state(uuid) TO authenticated;
CREATE POLICY conversations_number_provenance ON public.conversations
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.can_read_conversation_state(id));
CREATE POLICY conversation_messages_number_provenance ON public.conversation_messages
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.can_read_aggregate_conversation(conversation_id));

CREATE OR REPLACE FUNCTION public.oraculo_chat_scope_allows(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_lead_id uuid,
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.whatsapp_instances wi
      ON wi.id = p_instance_id AND wi.organization_id = p_organization_id
    WHERE l.id = p_lead_id
      AND l.organization_id = p_organization_id
      AND (
        p_team_member_id IS NULL
        OR (
          p_team_member_id IN (l.sdr_id, l.closer_id, l.pre_sale_responsible_id, l.sale_responsible_id)
          AND (
            EXISTS (
              SELECT 1 FROM public.whatsapp_instance_allowed_members a
              WHERE a.whatsapp_instance_id = p_instance_id
                AND a.team_member_id = p_team_member_id
                AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id=p_team_member_id AND tm.organization_id=p_organization_id AND tm.is_active)
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid) TO service_role;

-- Additional restrictions intersect the existing summary/owner policies.
CREATE POLICY conversation_summaries_number_assignment ON public.conversation_summaries
AS RESTRICTIVE FOR SELECT TO authenticated USING (
 (SELECT public.is_master_user()) OR (
   organization_id IN (SELECT public.get_my_organization_ids()) AND (
     public.is_org_admin(organization_id)
     OR instance_id=ANY((SELECT private.whatsapp_visible_instance_ids())::uuid[])
   )
 )
);
-- This aggregate has no number provenance; backend generation is unchanged.
CREATE POLICY conversation_context_summary_aggregate_read ON public.conversation_context_summary
AS RESTRICTIVE FOR SELECT TO authenticated USING (
 (SELECT public.is_master_user()) OR (
   organization_id IN (SELECT public.get_my_organization_ids())
   AND public.is_org_admin(organization_id)
 )
);

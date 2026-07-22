-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260719223147  name: gestor_rls_sweep_helper_union
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

DO $sweep$
DECLARE
  r record; nq text; nwc text; stmt text;
  m1 text := '( SELECT team_members.organization_id FROM team_members WHERE (team_members.user_id = ( SELECT auth.uid() AS uid)))';
  m2 text := '( SELECT tm.organization_id FROM team_members tm WHERE (tm.user_id = ( SELECT auth.uid() AS uid)))';
  m3 text := '( SELECT team_members.organization_id FROM team_members WHERE ((team_members.user_id = ( SELECT auth.uid() AS uid)) AND (team_members.is_active = true)))';
  m4 text := '( SELECT tm.organization_id FROM team_members tm WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.is_active = true)))';
  m5 text := '( SELECT tm.organization_id FROM team_members tm WHERE ((tm.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (tm.is_active = true)))';
  m6 text := '( SELECT team_members.organization_id FROM team_members WHERE ((team_members.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (team_members.is_active = true)))';
  a1 text := '( SELECT tm.organization_id FROM team_members tm WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ''admin''::app_role)))';
  a2 text := '( SELECT tm.organization_id FROM team_members tm WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ''admin''::app_role) AND (tm.is_active = true)))';
  a3 text := '( SELECT team_members.organization_id FROM team_members WHERE ((team_members.user_id = ( SELECT auth.uid() AS uid)) AND (team_members.role = ''admin''::app_role)))';
  t1 text := '( SELECT tm.id FROM team_members tm WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.is_active = true)))';
  mem text := '( SELECT public.get_my_organization_ids())';
  adm text := '( SELECT public.get_my_admin_organization_ids())';
  tmi text := '( SELECT public.get_my_team_member_ids())';
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, array_to_string(roles, ', ') AS roles, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND cmd IN ('SELECT','ALL')
      AND qual ~* 'from\s+team_members'
      AND coalesce(qual,'') !~* 'get_my_organization_ids|get_my_admin_organization_ids|get_my_team_member_ids|get_org_team_member_ids'
      AND tablename NOT IN ('mkt_origin_config','whatsapp_health_checks','conversation_messages','lead_custom_field_values')
      AND NOT (tablename='conversations' AND policyname='conversations_select_by_responsibility')
  LOOP
    nq := regexp_replace(r.qual, '\s+', ' ', 'g');
    nq := replace(nq,a2,adm); nq := replace(nq,a1,adm); nq := replace(nq,a3,adm);
    nq := replace(nq,m5,mem); nq := replace(nq,m6,mem); nq := replace(nq,m3,mem); nq := replace(nq,m4,mem);
    nq := replace(nq,m1,mem); nq := replace(nq,m2,mem); nq := replace(nq,t1,tmi);
    nwc := NULLIF(regexp_replace(coalesce(r.with_check,''), '\s+', ' ', 'g'), '');
    IF nwc IS NOT NULL THEN
      nwc := replace(nwc,a2,adm); nwc := replace(nwc,a1,adm); nwc := replace(nwc,a3,adm);
      nwc := replace(nwc,m5,mem); nwc := replace(nwc,m6,mem); nwc := replace(nwc,m3,mem); nwc := replace(nwc,m4,mem);
      nwc := replace(nwc,m1,mem); nwc := replace(nwc,m2,mem); nwc := replace(nwc,t1,tmi);
    END IF;
    IF nq ~* 'team_members' OR (nwc IS NOT NULL AND nwc ~* 'team_members') THEN
      RAISE EXCEPTION 'sweep: nao limpou team_members em %.%', r.tablename, r.policyname;
    END IF;
    IF (length(nq)-length(replace(nq,'(',''))) <> (length(nq)-length(replace(nq,')',''))) THEN
      RAISE EXCEPTION 'sweep: parenteses desbalanceados (qual) em %.%', r.tablename, r.policyname;
    END IF;
    IF nwc IS NOT NULL AND (length(nwc)-length(replace(nwc,'(',''))) <> (length(nwc)-length(replace(nwc,')',''))) THEN
      RAISE EXCEPTION 'sweep: parenteses desbalanceados (wc) em %.%', r.tablename, r.policyname;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    stmt := format('CREATE POLICY %I ON public.%I FOR %s TO %s USING (%s)', r.policyname, r.tablename, r.cmd, r.roles, nq);
    IF nwc IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', nwc); END IF;
    EXECUTE stmt;
  END LOOP;
END
$sweep$;

DROP POLICY IF EXISTS "mkt_origin_config_select" ON public.mkt_origin_config;
CREATE POLICY "mkt_origin_config_select" ON public.mkt_origin_config FOR SELECT TO public
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "whatsapp_health_checks_read" ON public.whatsapp_health_checks;
CREATE POLICY "whatsapp_health_checks_read" ON public.whatsapp_health_checks FOR SELECT TO authenticated
  USING (public.is_master_user() OR (organization_id IN (SELECT public.get_my_admin_organization_ids())));

DROP POLICY IF EXISTS "conversations_select_by_responsibility" ON public.conversations;
CREATE POLICY "conversations_select_by_responsibility" ON public.conversations FOR SELECT TO public
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids()))
    AND (
      (SELECT is_user_admin())
      OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to)
      OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to)
      OR (organization_id IN (SELECT public.get_my_gestor_organization_ids()))
    )
  );

DROP POLICY IF EXISTS "conversation_messages_select_by_conversation" ON public.conversation_messages;
CREATE POLICY "conversation_messages_select_by_conversation" ON public.conversation_messages FOR SELECT TO public
  USING (
    conversation_id IN (
      SELECT conversations.id FROM conversations
      WHERE (conversations.organization_id IN (SELECT public.get_my_organization_ids()))
        AND (
          (SELECT is_user_admin())
          OR is_user_responsible(NULL::uuid, NULL::uuid, conversations.assigned_to)
          OR has_no_responsible(NULL::uuid, NULL::uuid, conversations.assigned_to)
          OR (conversations.organization_id IN (SELECT public.get_my_gestor_organization_ids()))
        )
    )
  );

DROP POLICY IF EXISTS "lead_custom_field_values_select_by_lead" ON public.lead_custom_field_values;
CREATE POLICY "lead_custom_field_values_select_by_lead" ON public.lead_custom_field_values FOR SELECT TO public
  USING (
    lead_id IN (
      SELECT leads.id FROM leads
      WHERE (leads.organization_id IN (SELECT public.get_my_organization_ids()))
        AND (
          (SELECT is_user_admin())
          OR is_user_responsible(leads.sdr_id, leads.closer_id, NULL::uuid)
          OR has_no_responsible(leads.sdr_id, leads.closer_id, NULL::uuid)
          OR (leads.organization_id IN (SELECT public.get_my_gestor_organization_ids()))
        )
    )
  );

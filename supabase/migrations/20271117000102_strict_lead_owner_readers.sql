
-- Scopes also apply to related records and authenticated SECURITY DEFINER readers.
-- Views are internal source adapters, deliberately NOT granted to API roles.
-- They keep original relation names so existing qualified references remain valid.
CREATE FUNCTION private.strict_lead_ref_visible(p_lead uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id=p_lead
      AND l.organization_id=ANY((SELECT private.strict_lead_member_orgs())::uuid[])
      AND NOT private.strict_lead_is_owned(l.organization_id,l.id)
  )
$$;
CREATE FUNCTION private.strict_phone_visible(p_org uuid,p_lead uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT (p_org=ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
    OR EXISTS (
      SELECT 1 FROM public.leads l WHERE l.organization_id=p_org
        AND ((p_lead IS NOT NULL AND l.id=p_lead)
          OR (p_lead IS NULL AND l.normalized_phone=p_phone))
        AND private.strict_lead_is_owned(p_org,l.id)
    )
$$;
REVOKE ALL ON FUNCTION private.strict_lead_ref_visible(uuid),private.strict_phone_visible(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.strict_lead_ref_visible(uuid),private.strict_phone_visible(uuid,uuid,text) TO authenticated,service_role;

CREATE FUNCTION private.strict_channel_visible(p_org uuid,p_lead uuid,p_channel text,p_external text,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT(p_org=ANY((SELECT private.strict_lead_member_orgs())::uuid[]))
 OR EXISTS (
   SELECT 1 FROM public.messaging_channels mc JOIN public.lead_social_identities si
     ON si.organization_id=mc.organization_id AND si.channel_type=mc.channel_type
   WHERE mc.id::text=p_channel AND mc.organization_id=p_org AND si.external_user_id=p_external
     AND private.strict_lead_is_owned(p_org,si.lead_id)
 )
 OR (NOT EXISTS(SELECT 1 FROM public.messaging_channels mc WHERE mc.id::text=p_channel
       AND mc.organization_id=p_org AND mc.channel_type IN('instagram','facebook','messenger'))
   AND private.strict_phone_visible(p_org,p_lead,public.normalize_brazilian_phone(COALESCE(p_phone,p_external))))
$$;
REVOKE ALL ON FUNCTION private.strict_channel_visible(uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.strict_channel_visible(uuid,uuid,text,text,text) TO authenticated,service_role;

CREATE TABLE private.strict_lead_scope_manifest (
  relation_name text PRIMARY KEY, predicate text NOT NULL, added_policy boolean NOT NULL
);
CREATE TABLE private.strict_lead_rpc_restore (
  signature text PRIMARY KEY, original_definition text NOT NULL, hardened_definition text NOT NULL
);
REVOKE ALL ON private.strict_lead_scope_manifest,private.strict_lead_rpc_restore FROM PUBLIC,anon,authenticated,service_role;

DO $scope$
DECLARE r record; v_pred text; v_has_org boolean; v_kind "char";
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('leads','id'),
    ('pipeline_entries','lead_id'),
    ('acoes_do_dia','lead_id'),
    ('activities','lead_id'),
    ('ai_email_drafts','lead_id'),
    ('call_logs','lead_id'),
    ('channel_messages','lead_id'),
    ('checklists','lead_id'),
    ('competitor_mentions','lead_id'),
    ('consent_records','lead_id'),
    ('conversation_context_summary','lead_id'),
    ('conversation_summaries','lead_id'),
    ('copilot_conversation_evaluations','lead_id'),
    ('copilot_followup_execution_log','lead_id'),
    ('copilot_followup_step_log','lead_id'),
    ('copilot_v2_message_queue','lead_id'),
    ('copilot_v2_traces','lead_id'),
    ('data_export_requests','lead_id'),
    ('deleted_leads_log','lead_id'),
    ('emails','lead_id'),
    ('enrichment_requests','lead_id'),
    ('follow_ups','lead_id'),
    ('followup_automation_log','lead_id'),
    ('google_calendar_events_cache','lead_id'),
    ('historical_sale_batches','lead_id'),
    ('lead_comments','lead_id'),
    ('lead_document_events','lead_id'),
    ('lead_documents','lead_id'),
    ('lead_history','lead_id'),
    ('lead_memories','lead_id'),
    ('lead_owners','lead_id'),
    ('lead_phones','lead_id'),
    ('lead_products','lead_id'),
    ('lead_social_identities','lead_id'),
    ('meeting_events','lead_id'),
    ('meetings','lead_id'),
    ('meta_conversations','lead_id'),
    ('meta_signals_sent','lead_id'),
    ('next_best_actions','lead_id'),
    ('notifications','lead_id'),
    ('outbound_dispatch_log','lead_id'),
    ('pending_ai_actions','lead_id'),
    ('pipeline_stage_events','lead_id'),
    ('sale_events','lead_id'),
    ('scheduled_pipe_messages','lead_id'),
    ('scheduled_user_messages','lead_id'),
    ('sms_messages','lead_id'),
    ('upsell_clients','lead_id'),
    ('voip_calls','lead_id'),
    ('whatsapp_conversation_summary','lead_id'),
    ('whatsapp_messages','lead_id'),
    ('workflow_executions','lead_id'),
    ('blast_plan_recipients','lead_id'),
    ('campanha_leads','lead_id'),
    ('copilot_ab_assignments','lead_id'),
    ('lead_custom_field_values','lead_id'),
    ('lead_scores','lead_id'),
    ('lead_tags','lead_id'),
    ('leads_reativacao','lead_id'),
    ('scheduled_campaign_messages','lead_id'),
    ('negocio_projetado','lead_id'),
    ('unified_inbox_messages','lead_id'),
    ('v_sale_events_negocio','lead_id'),
    ('conversations','lead_id'),
    ('deals','source_lead_id'),
    ('contacts','source_lead_id'),
    ('field_changes','entity_id'),
    ('recent_items','entity_id'),
    ('phone_ai_preferences','phone'),
    ('whatsapp_conversations','phone'),
    ('conversation_read_state','phone')
  ) AS sources(relation_name,lead_column) LOOP
    -- Some earlier installations have not yet added optional modules.
    IF to_regclass('public.'||r.relation_name) IS NULL THEN CONTINUE; END IF;
    IF to_regclass('private.'||r.relation_name) IS NOT NULL THEN
      RAISE EXCEPTION 'Scoped view name is already used: %',r.relation_name;
    END IF;
    SELECT relkind INTO v_kind FROM pg_class WHERE oid=to_regclass('public.'||r.relation_name);
    SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||r.relation_name)
      AND attname='organization_id' AND NOT attisdropped) INTO v_has_org;
    IF r.lead_column='phone' THEN
      v_pred := 'private.strict_phone_visible(organization_id,NULL,normalized_phone)';
      IF r.relation_name='conversation_read_state' THEN
        v_pred := 'private.strict_channel_visible(organization_id,NULL,split_part(conversation_key,'':'',2),substring(conversation_key from ''^[^:]*:[^:]*:(.*)$''),NULL)';
      END IF;
    ELSIF v_has_org THEN
      v_pred := format('NOT (organization_id=ANY((SELECT private.strict_lead_member_orgs())::uuid[])) OR private.strict_lead_is_owned(organization_id,%I)',r.lead_column);
      IF r.relation_name IN ('activities','meetings','deals','contacts') THEN
        v_pred := format('%I IS NULL OR (%s)',r.lead_column,v_pred);
      END IF;
      IF r.relation_name='activities' THEN
        v_pred := 'NOT (organization_id=ANY((SELECT private.strict_lead_member_orgs())::uuid[])) OR (('||v_pred||') AND (deal_id IS NULL OR EXISTS (SELECT 1 FROM public.deals d WHERE d.id=deal_id AND private.strict_lead_ref_visible(d.source_lead_id))))';
      END IF;
      IF r.relation_name IN ('field_changes','recent_items') THEN
        v_pred := 'entity_type IS DISTINCT FROM ''lead'' OR ('||v_pred||')';
      END IF;
      IF r.relation_name IN ('whatsapp_messages','whatsapp_conversation_summary') THEN
        v_pred := 'private.strict_phone_visible(organization_id,lead_id,normalized_phone)';
      END IF;
      IF r.relation_name='channel_messages' THEN
        v_pred := 'private.strict_channel_visible(organization_id,lead_id,messaging_channel_id::text,contact_external_id,phone_number)';
      END IF;
    ELSE
      v_pred := format('private.strict_lead_ref_visible(%I)',r.lead_column);
    END IF;
    -- security_invoker prevents these views becoming a second tenant-access path.
    -- A definer RPC still bypasses RLS, but NEVER the explicit WHERE predicate.
    EXECUTE format('CREATE VIEW private.%I WITH (security_invoker=true) AS SELECT * FROM public.%I WHERE %s',r.relation_name,r.relation_name,v_pred);
    EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',r.relation_name);
    IF v_kind='r' AND r.relation_name NOT IN ('leads','pipeline_entries') THEN
      EXECUTE format('CREATE POLICY strict_owner_related_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)',r.relation_name,v_pred);
    END IF;
    INSERT INTO private.strict_lead_scope_manifest VALUES(r.relation_name,v_pred,v_kind='r' AND r.relation_name NOT IN ('leads','pipeline_entries'));
  END LOOP;
END $scope$;

DO $readers$
DECLARE f record; r record; v_old text; v_new text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.proname=ANY(ARRAY[
      'can_view_lead',
      'check_sla_breaches',
      'find_duplicate_leads',
      'get_activities',
      'get_analytics_commercial_metrics',
      'get_analytics_engagement_metrics',
      'get_analytics_financial_metrics',
      'get_analytics_overview_metrics',
      'get_analytics_pipeline_metrics',
      'get_commission_ledger',
      'get_competitor_stats',
      'get_conversations_awaiting_human_reply',
      'get_conversations_awaiting_human_reply_multi',
      'get_dashboard_metrics',
      'get_email_thread',
      'get_funil_desfecho_counts',
      'get_funnel_conversion',
      'get_funnel_flow',
      'get_funnel_health',
      'get_funnel_health_stage_leads',
      'get_help_article_feedback_summaries',
      'get_import_batches',
      'get_jobs_overview',
      'get_lead_ai_status',
      'get_lead_field_changes',
      'get_lead_write_instance',
      'get_leads_by_uf',
      'get_mkt_origin_metrics',
      'get_movement_metrics',
      'get_my_admin_organization_ids',
      'get_my_gestor_organization_ids',
      'get_my_member_organization_ids',
      'get_my_org_ids',
      'get_my_organization_ids',
      'get_my_team_admin_organization_ids',
      'get_my_team_member_ids',
      'get_next_best_actions',
      'get_official_whatsapp_conversation_list',
      'get_official_whatsapp_conversation_list_multi',
      'get_operations_overview',
      'get_org_team_member_ids',
      'get_pending_orders',
      'get_phone_ai_status',
      'get_pipeline_velocity',
      'get_portfolio_clients',
      'get_portfolio_kpis',
      'get_portfolio_trends',
      'get_product_ranking',
      'get_productivity_activity',
      'get_productivity_activity_by_seller',
      'get_productivity_activity_leads',
      'get_ranking',
      'get_ranking_data',
      'get_recent_items',
      'get_revenue_at_risk',
      'get_revenue_attribution',
      'get_sales_cycle_analysis',
      'get_sales_metrics',
      'get_segment_benchmark',
      'get_seller_activity_scores',
      'get_social_conversation_list',
      'get_trash_leads',
      'get_uf_heatmap',
      'get_unified_conversations',
      'get_unread_counts',
      'get_unread_total',
      'get_usage_by_org',
      'get_user_org_role',
      'get_user_organization_id',
      'get_vendedor_ranking',
      'get_whatsapp_conversation_list',
      'get_whatsapp_conversation_list_multi',
      'get_win_loss_analysis',
      'get_workflow_button_history',
      'get_workflow_execution_history',
      'get_workflow_execution_stats',
      'get_workflow_execution_steps',
      'get_workflow_node_stats',
      'search_messages',
      'can_link_or_read_lead',
      'carteira_list_orders'
    ])
  LOOP
    v_old:=pg_get_functiondef(f.oid); v_new:=v_old;
    FOR r IN SELECT relation_name FROM private.strict_lead_scope_manifest LOOP
      -- Only relation reads, never rowtype declarations or write targets.
      -- A CTE (e.g. funnel-health's "meetings") shadows the table name.
      -- Those references must stay on the CTE; qualified sources are unambiguous.
      IF v_old ~* ('\m'||r.relation_name||'\s+AS\s+(?:(?:NOT\s+)?MATERIALIZED\s*)?\(') THEN
        v_new:=regexp_replace(v_new,'\m(FROM|JOIN)(\s+)public\.'||r.relation_name||'\M',
          '\1\2private.'||r.relation_name,'gi');
      ELSE
        v_new:=regexp_replace(v_new,'\m(FROM|JOIN)(\s+)(public\.)?'||r.relation_name||'\M',
          '\1\2private.'||r.relation_name,'gi');
      END IF;
    END LOOP;
    IF v_new<>v_old THEN
      EXECUTE v_new;
      INSERT INTO private.strict_lead_rpc_restore VALUES(f.oid::regprocedure::text,v_old,pg_get_functiondef(f.oid));
    END IF;
  END LOOP;
END $readers$;

-- Chat permission keeps its original recipient and WhatsApp-instance checks.
DO $chat$
DECLARE v_oid oid:='public.can_see_chat_scope(uuid,uuid,text)'::regprocedure;
BEGIN
  INSERT INTO private.strict_lead_rpc_restore VALUES(v_oid::regprocedure::text,pg_get_functiondef(v_oid),'');
END $chat$;
CREATE OR REPLACE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT private.strict_phone_visible(p_org_id,p_lead_id,p_normalized_phone)
 AND private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone);
$function$
;
UPDATE private.strict_lead_rpc_restore SET hardened_definition=pg_get_functiondef('public.can_see_chat_scope(uuid,uuid,text)'::regprocedure)
WHERE signature='can_see_chat_scope(uuid,uuid,text)';

-- Push workers evaluate another recipient: use its explicit identity, never the worker JWT.
CREATE OR REPLACE FUNCTION private.strict_lead_owned_by(p_org uuid, p_lead uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.team_members tm ON tm.organization_id = l.organization_id
      AND tm.user_id = p_user_id AND tm.is_active
    WHERE l.id = p_lead AND l.organization_id = p_org AND l.deleted_at IS NULL
      AND (
        tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)
        OR EXISTS (
          SELECT 1 FROM public.lead_owners own
          WHERE own.lead_id = l.id AND own.organization_id = p_org
            AND own.team_member_id = tm.id AND own.role = 'co'
        )
        OR EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.lead_id = l.id AND pe.organization_id = p_org
            AND (pe.assigned_to = tm.id OR tm.id::text IN (
              pe.metadata->>'pre_sale_responsible_id', pe.metadata->>'sale_responsible_id',
              pe.metadata->>'sdr_id', pe.metadata->>'closer_id', pe.metadata->>'responsible_id'
            ))
        )
      )
  )
$$;
REVOKE ALL ON FUNCTION private.strict_lead_owned_by(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $recipient$
DECLARE v_oid oid:='private.chat_scope_for_recipient(uuid,uuid,uuid,text)'::regprocedure;
BEGIN
 INSERT INTO private.strict_lead_rpc_restore VALUES(v_oid::regprocedure::text,pg_get_functiondef(v_oid),'');
END $recipient$;
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

  IF EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org_id AND feature_flags @> '{"strict_lead_owner_access":true}'::jsonb) THEN
    RETURN EXISTS(SELECT 1 FROM public.team_members WHERE id=v_team_member_id AND role='admin')
      OR EXISTS(SELECT 1 FROM public.leads l WHERE l.organization_id=p_org_id
        AND ((p_lead_id IS NOT NULL AND l.id=p_lead_id) OR (p_lead_id IS NULL AND l.normalized_phone=p_normalized_phone))
        AND private.strict_lead_owned_by(p_org_id,l.id,p_user_id));
  END IF;

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
UPDATE private.strict_lead_rpc_restore SET hardened_definition=pg_get_functiondef('private.chat_scope_for_recipient(uuid,uuid,uuid,text)'::regprocedure)
WHERE signature='private.chat_scope_for_recipient(uuid,uuid,uuid,text)';

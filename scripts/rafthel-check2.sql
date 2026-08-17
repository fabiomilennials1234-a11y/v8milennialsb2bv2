SELECT jsonb_pretty(jsonb_build_object(
  'fn_sync_org_plan_quotas', (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_org_plan_quotas'),
  'fn_create_default_pipeline_stages', (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_default_pipeline_stages'),
  'colunas_pipeline_stages', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('col',c.column_name,'tipo',c.data_type,'nullable',c.is_nullable,'default',c.column_default,'generated',c.is_generated) ORDER BY c.ordinal_position),'[]'::jsonb)
    FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='pipeline_stages'
  ),
  'colunas_team_members', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('col',c.column_name,'tipo',c.data_type,'nullable',c.is_nullable,'default',c.column_default,'generated',c.is_generated) ORDER BY c.ordinal_position),'[]'::jsonb)
    FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='team_members'
  ),
  'org_subscriptions_total', (SELECT count(*) FROM public.org_subscriptions),
  'loofting_stages', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('pt',ps.pipeline_type,'key',ps.stage_key,'name',ps.name,'pos',ps.position) ORDER BY ps.pipeline_type, ps.position),'[]'::jsonb)
    FROM public.pipeline_stages ps WHERE ps.organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'
  ),
  'loofting_display', (
    SELECT coalesce(jsonb_agg(to_jsonb(d.*)),'[]'::jsonb) FROM public.pipeline_display_config d WHERE d.organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'
  ),
  'orgs_recentes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('name',o.name,'slug',o.slug,'plan',o.subscription_plan,'status',o.subscription_status,'exp',o.subscription_expires_at,'criada',o.created_at) ORDER BY o.created_at DESC),'[]'::jsonb)
    FROM (SELECT * FROM public.organizations ORDER BY created_at DESC LIMIT 6) o
  )
)) AS r;

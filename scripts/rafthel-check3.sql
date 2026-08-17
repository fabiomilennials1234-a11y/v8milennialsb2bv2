SELECT jsonb_pretty(jsonb_build_object(
  'loofting_stages_full', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'pt',ps.pipeline_type,'key',ps.stage_key,'name',ps.name,'color',ps.color,'pos',ps.position,
      'fp',ps.is_final_positive,'fn',ps.is_final_negative,'role',ps.stage_role,'prob',ps.default_probability,
      'tgt_pipe',ps.target_pipe_type,'tgt_stage',ps.target_stage_key,
      'tgt_pipeline_id',ps.target_pipeline_id,'tgt_stage_id',ps.target_stage_id,
      'checklist',ps.checklist_template_id,'sla_esc',ps.sla_escalate_to,'sla_h',ps.sla_hours,'sla_a',ps.sla_action,
      'amin',ps.auto_move_min_days,'amax',ps.auto_move_max_days,'maxd',ps.max_days_in_stage
    ) ORDER BY ps.pipeline_type, ps.position),'[]'::jsonb)
    FROM public.pipeline_stages ps WHERE ps.organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'
  ),
  'loofting_pipelines', (
    SELECT coalesce(jsonb_agg(to_jsonb(p.*)),'[]'::jsonb) FROM public.pipelines p WHERE p.organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'
  ),
  'fn_create_default_pipelines', (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_default_pipelines'),
  'fn_ensure_pipeline_display_config', (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='ensure_pipeline_display_config'),
  'loofting_extras', jsonb_build_object(
    'loss_reasons', (SELECT count(*) FROM public.loss_reasons WHERE organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7'),
    'org_quotas', (SELECT coalesce(jsonb_agg(jsonb_build_object('k',q.resource_key,'base',q.plan_base,'adj',q.admin_adjustment,'eff',q.effective_limit)),'[]'::jsonb) FROM public.org_quotas q WHERE q.organization_id='70b8775e-7cbc-4b6f-90ba-2011002e57f7')
  )
)) AS r;

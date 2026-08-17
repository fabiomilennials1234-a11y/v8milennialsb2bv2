SELECT jsonb_pretty(jsonb_build_object(
  'orgs_parecidas', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug,
      'plan', o.subscription_plan, 'status', o.subscription_status,
      'created_at', o.created_at,
      'membros', (SELECT count(*) FROM public.team_members tm WHERE tm.organization_id = o.id)
    ) ORDER BY o.created_at), '[]'::jsonb)
    FROM public.organizations o
    WHERE o.name ILIKE '%rafthel%' OR o.slug ILIKE '%rafthel%'
       OR o.name ILIKE '%rafte%'   OR o.slug ILIKE '%rafte%'
       OR o.name ILIKE '%raftel%'  OR o.slug ILIKE '%raftel%'
  ),
  'emails_existentes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'orgs', (SELECT coalesce(jsonb_agg(og.name), '[]'::jsonb)
               FROM public.team_members tm JOIN public.organizations og ON og.id = tm.organization_id
               WHERE tm.user_id = u.id)
    )), '[]'::jsonb)
    FROM auth.users u
    WHERE u.email ILIKE '%@rafthel.com.br'
       OR u.email IN ('rafthel@rafthel.com.br','vendas6@rafthel.com.br','vendas4@rafthel.com.br')
  ),
  'planos', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', sp.id, 'name', sp.name, 'display_name', sp.display_name,
      'is_default', sp.is_default, 'limits', sp.limits
    ) ORDER BY sp.name), '[]'::jsonb)
    FROM public.subscription_plans sp
  ),
  'colunas_organizations', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'col', c.column_name, 'tipo', c.data_type,
      'nullable', c.is_nullable, 'default', c.column_default,
      'generated', c.is_generated
    ) ORDER BY c.ordinal_position), '[]'::jsonb)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'organizations'
  ),
  'triggers_organizations', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'trigger', t.tgname, 'fn', p.proname, 'enabled', t.tgenabled
    ) ORDER BY t.tgname), '[]'::jsonb)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND c.relname = 'organizations' AND NOT t.tgisinternal
  ),
  'org_referencia_loofting', (
    SELECT jsonb_build_object('id', o.id, 'name', o.name,
      'etapas', (SELECT count(*) FROM public.pipeline_stages ps WHERE ps.organization_id = o.id))
    FROM public.organizations o WHERE o.name ILIKE '%loofting%' LIMIT 1
  )
)) AS check;

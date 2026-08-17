WITH org AS (SELECT * FROM public.organizations WHERE id = '7af43ad3-17b0-4365-835b-3922511ef4de')
SELECT jsonb_pretty(jsonb_build_object(
  'org', (SELECT jsonb_build_object('name',o.name,'slug',o.slug,'plano',o.subscription_plan,
            'status',o.subscription_status,
            'auto_create_lead_on_inbound', o.auto_create_lead_on_inbound,
            'whatsapp_provider_override', o.whatsapp_provider_override) FROM org o),
  'membros', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome',tm.name,'papel',tm.role,'ativo',tm.is_active) ORDER BY tm.role, tm.name),'[]'::jsonb)
              FROM public.team_members tm JOIN org ON org.id=tm.organization_id),
  'instancias_whatsapp', (SELECT count(*) FROM public.whatsapp_instances w JOIN org ON org.id=w.organization_id),
  'leads', (SELECT count(*) FROM public.leads l JOIN org ON org.id=l.organization_id),
  'etapas_whatsapp', (SELECT coalesce(jsonb_agg(jsonb_build_object('key',ps.stage_key,'nome',ps.name,'pos',ps.position) ORDER BY ps.position),'[]'::jsonb)
                      FROM public.pipeline_stages ps JOIN org ON org.id=ps.organization_id WHERE ps.pipeline_type='whatsapp'),
  'funis_custom', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome',cp.name,'slug',cp.slug,
                       'etapas',(SELECT count(*) FROM public.custom_pipeline_stages s WHERE s.pipeline_id=cp.id))),'[]'::jsonb)
                   FROM public.custom_pipelines cp JOIN org ON org.id=cp.organization_id),
  'workflows', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome',w.name,'ativo',w.is_active,
                       'nos',jsonb_array_length(coalesce(w.definition->'nodes','[]'::jsonb))) ORDER BY w.name),'[]'::jsonb)
                FROM public.workflows w JOIN org ON org.id=w.organization_id),
  'workflows_ligados', (SELECT count(*) FROM public.workflows w JOIN org ON org.id=w.organization_id WHERE w.is_active),
  -- ⚠️ NÃO procurar por '%rafthel%': o caminho no Storage usa o UUID da org,
  -- a palavra "rafthel" não aparece nele. A checagem antiga dava 0 para sempre.
  -- O que decide é: o arquivo apontado pelo nó de imagem EXISTE?
  'midia_dos_nos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'workflow', w.name,
                        'no', n->>'id',
                        'url', n->'data'->>'imageUrl',
                        'arquivo_existe', (SELECT count(*) FROM storage.objects o
                                            WHERE o.bucket_id='media'
                                              AND o.name = regexp_replace(n->'data'->>'imageUrl','^.*/public/media/','')),
                        'org_dona_do_arquivo', (SELECT o2.name FROM public.organizations o2
                                                 WHERE o2.id::text = (storage.foldername(regexp_replace(n->'data'->>'imageUrl','^.*/public/media/','')))[2])
                      ) ORDER BY w.name),'[]'::jsonb)
                    FROM public.workflows w JOIN org ON org.id=w.organization_id,
                         jsonb_array_elements(w.definition->'nodes') n
                    WHERE n->'data'->>'actionType'='send_whatsapp_image'
                      AND n->'data'->>'imageUrl' IS NOT NULL)
)) AS estado;

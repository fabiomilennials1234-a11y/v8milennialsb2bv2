SELECT 'orgs_total' AS q, count(*)::text AS v FROM organizations
UNION ALL SELECT 'orgs_com_display_config', count(DISTINCT organization_id)::text FROM pipeline_display_config
UNION ALL SELECT 'orgs_COM_funil_sistema_SEM_config', count(*)::text FROM (
  SELECT DISTINCT p.organization_id FROM pipelines p
   WHERE p.type='system' AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM pipeline_display_config c WHERE c.organization_id=p.organization_id)
) x
UNION ALL SELECT 'linhas_display_config', count(*)::text FROM pipeline_display_config;

SELECT o.name AS org, o.id::text, o.created_at::date AS criada,
       (SELECT count(*) FROM pipelines p WHERE p.organization_id=o.id AND p.type='system' AND p.is_active) AS funis_sistema,
       (SELECT count(*) FROM leads l WHERE l.organization_id=o.id) AS leads,
       (SELECT count(*) FROM pipeline_entries e WHERE e.organization_id=o.id) AS cards,
       (SELECT max(e.entered_at)::date FROM pipeline_entries e WHERE e.organization_id=o.id) AS ultimo_card,
       (SELECT count(*) FROM team_members t WHERE t.organization_id=o.id AND t.is_active) AS membros
  FROM organizations o
 WHERE EXISTS (SELECT 1 FROM pipelines p WHERE p.organization_id=o.id AND p.type='system' AND p.is_active)
   AND NOT EXISTS (SELECT 1 FROM pipeline_display_config c WHERE c.organization_id=o.id);

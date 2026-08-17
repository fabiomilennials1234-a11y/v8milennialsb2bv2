WITH loof AS (
  SELECT * FROM public.pipeline_stages WHERE organization_id = '70b8775e-7cbc-4b6f-90ba-2011002e57f7'
), modal AS (
  SELECT ps.pipeline_type, ps.stage_key, ps.name, ps.color, ps.position, ps.stage_role,
         ps.is_final_positive, ps.is_final_negative, ps.target_pipe_type, ps.target_stage_key,
         count(*) AS orgs,
         row_number() OVER (PARTITION BY ps.pipeline_type, ps.stage_key ORDER BY count(*) DESC) AS rn
  FROM public.pipeline_stages ps
  WHERE (ps.pipeline_type, ps.stage_key) IN (SELECT pipeline_type, stage_key FROM loof)
  GROUP BY 1,2,3,4,5,6,7,8,9,10
), canon AS (SELECT * FROM modal WHERE rn = 1)
SELECT jsonb_pretty(jsonb_build_object(
  'etapas_loofting', (SELECT count(*) FROM loof),
  'divergencias', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'pt', l.pipeline_type, 'key', l.stage_key,
      'campo_divergente', concat_ws(', ',
        CASE WHEN c.name IS DISTINCT FROM l.name THEN 'name' END,
        CASE WHEN c.color IS DISTINCT FROM l.color THEN 'color' END,
        CASE WHEN c.position IS DISTINCT FROM l.position THEN 'position' END,
        CASE WHEN c.stage_role IS DISTINCT FROM l.stage_role THEN 'stage_role' END,
        CASE WHEN c.is_final_positive IS DISTINCT FROM l.is_final_positive THEN 'is_final_positive' END,
        CASE WHEN c.is_final_negative IS DISTINCT FROM l.is_final_negative THEN 'is_final_negative' END,
        CASE WHEN c.target_pipe_type IS DISTINCT FROM l.target_pipe_type THEN 'target_pipe_type' END,
        CASE WHEN c.target_stage_key IS DISTINCT FROM l.target_stage_key THEN 'target_stage_key' END),
      'maioria', jsonb_build_object('name',c.name,'color',c.color,'pos',c.position,'role',c.stage_role,'orgs',c.orgs),
      'loofting', jsonb_build_object('name',l.name,'color',l.color,'pos',l.position,'role',l.stage_role)
    )), '[]'::jsonb)
    FROM loof l JOIN canon c ON c.pipeline_type = l.pipeline_type AND c.stage_key = l.stage_key
    WHERE c.name IS DISTINCT FROM l.name OR c.color IS DISTINCT FROM l.color
       OR c.position IS DISTINCT FROM l.position OR c.stage_role IS DISTINCT FROM l.stage_role
       OR c.is_final_positive IS DISTINCT FROM l.is_final_positive
       OR c.is_final_negative IS DISTINCT FROM l.is_final_negative
       OR c.target_pipe_type IS DISTINCT FROM l.target_pipe_type
       OR c.target_stage_key IS DISTINCT FROM l.target_stage_key
  ),
  'orgs_com_as_33_iguais', (
    SELECT count(*) FROM (
      SELECT ps.organization_id FROM public.pipeline_stages ps
      JOIN canon c ON c.pipeline_type=ps.pipeline_type AND c.stage_key=ps.stage_key
        AND c.name=ps.name AND c.position=ps.position
      GROUP BY ps.organization_id HAVING count(*) = 33
    ) x
  )
)) AS r;

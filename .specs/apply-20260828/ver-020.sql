SELECT 'pipeline_stages_exigem' AS q, count(*)::text AS v FROM pipeline_stages WHERE requires_sale_value
UNION ALL SELECT 'custom_stages_exigem', count(*)::text FROM custom_pipeline_stages WHERE requires_sale_value
UNION ALL SELECT 'GUARDA_etapa_ganho_sem_flag', count(*)::text FROM (
  SELECT stage_role, is_final_positive, requires_sale_value FROM pipeline_stages
  UNION ALL SELECT stage_role, is_final_positive, requires_sale_value FROM custom_pipeline_stages) s
 WHERE (s.stage_role='won' OR COALESCE(s.is_final_positive,false)) AND s.requires_sale_value = false;

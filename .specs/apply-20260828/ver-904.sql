SELECT 'outcome_' || outcome AS q, count(*)::text AS v FROM deals WHERE deleted_at IS NULL GROUP BY 1
UNION ALL SELECT 'GUARDA_espelho_divergente', count(*)::text FROM deals
  WHERE deleted_at IS NULL AND won IS DISTINCT FROM (outcome='won')
UNION ALL SELECT 'GUARDA_lost_sem_closed_at', count(*)::text FROM deals
  WHERE outcome='lost' AND closed_at IS NULL AND deleted_at IS NULL
UNION ALL SELECT 'won_null_restantes', count(*)::text FROM deals WHERE won IS NULL
UNION ALL SELECT 'sale_events_total', count(*)::text FROM sale_events
ORDER BY 1;

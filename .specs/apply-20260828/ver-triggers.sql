SELECT 'triggers_em_deals' AS q, (SELECT string_agg(tgname, ', ' ORDER BY tgname)
   FROM pg_trigger WHERE tgrelid='public.deals'::regclass AND NOT tgisinternal) AS v
UNION ALL SELECT 'fn_capture_insere_direto',
  (SELECT count(*)::text FROM regexp_matches(
     pg_get_functiondef('public.fn_capture_sale_event()'::regprocedure),
     'INSERT\s+INTO\s+public\.sale_events','g'))
UNION ALL SELECT 'valor_em_aberto_total_agora',
  (public._metric_leaf_valor_em_aberto((SELECT id FROM organizations WHERE name='Milennials'),'total','{}'::jsonb)->>'value');

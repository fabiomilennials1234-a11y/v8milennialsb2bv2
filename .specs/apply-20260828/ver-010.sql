SELECT o.name AS org,
       left(public._metric_leaf_valor_em_aberto(o.id, 'etapa', '{}'::jsonb)::text, 300) AS valor_por_etapa
  FROM organizations o WHERE o.name = 'Milennials';

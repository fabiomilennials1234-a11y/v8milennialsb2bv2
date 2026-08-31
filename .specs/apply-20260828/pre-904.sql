SELECT CASE WHEN won IS TRUE THEN 'won'
            WHEN won IS NOT TRUE AND closed_at IS NOT NULL THEN 'lost'
            ELSE 'open' END AS esperado,
       count(*) AS n
  FROM deals WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;

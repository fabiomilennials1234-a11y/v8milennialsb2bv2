-- Fix workflow "Definir responsável por campanha" (org 6e5f6a20…af31)
-- Node condition-13250205: origin equals "Meta Ads" (label) -> "meta_ads" (slug)
-- Sem isso, todo lead meta_ads cai no ramo NO -> end e ninguém é atribuído.

UPDATE workflows w
SET definition = jsonb_set(
  w.definition, '{nodes}',
  (SELECT jsonb_agg(
     CASE WHEN n->>'id' = 'condition-13250205'
          THEN jsonb_set(n, '{data,value}', '"meta_ads"')
          ELSE n END)
   FROM jsonb_array_elements(w.definition->'nodes') n)
),
updated_at = now()
WHERE w.id = '97bdb54c-b5d6-45c8-8c6c-96f843d80d6e';

-- Verificação (deve mostrar value = meta_ads)
SELECT n->'data'->>'field' AS field, n->'data'->>'operator' AS op, n->'data'->>'value' AS value_after
FROM workflows w, jsonb_array_elements(w.definition->'nodes') n
WHERE w.id = '97bdb54c-b5d6-45c8-8c6c-96f843d80d6e' AND n->>'id' = 'condition-13250205';

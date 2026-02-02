-- Lista quantos leads cada organização tem (para identificar qual org tem os 30 cards).
-- Execute no Supabase Dashboard → SQL Editor.
-- Use o organization_id que tiver a quantidade de leads que você vê na tela.

SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  o.slug,
  COUNT(l.id) AS total_leads
FROM public.organizations o
LEFT JOIN public.leads l ON l.organization_id = o.id
GROUP BY o.id, o.name, o.slug
ORDER BY total_leads DESC;

-- Ativação separada do schema. Aplicar somente após autorização de produção,
-- migration 20271019000004 e disponibilização do frontend correspondente.
BEGIN;
UPDATE public.organizations
SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
  || '{"leads_cafe_jurere_cadastro_erp":true}'::jsonb
WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
SELECT id, feature_flags->'leads_cafe_jurere_cadastro_erp' AS flag
FROM public.organizations
WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
COMMIT;

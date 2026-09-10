-- Rollout exclusivo Ventimais. Não executar antes de publicar/revisar o frontend.
-- Preserva todas as outras flags e não atualiza nenhuma outra organização.
BEGIN;
UPDATE public.organizations
SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
  || '{"kanban_export_details": true}'::jsonb
WHERE id = '56b88e32-be6a-436e-b4e6-6e1293d21659';
SELECT id, name, feature_flags -> 'kanban_export_details' AS kanban_export_details
FROM public.organizations
WHERE id = '56b88e32-be6a-436e-b4e6-6e1293d21659';
COMMIT;

-- Reversão (executar separadamente):
-- UPDATE public.organizations
-- SET feature_flags = coalesce(feature_flags, '{}'::jsonb) - 'kanban_export_details'
-- WHERE id = '56b88e32-be6a-436e-b4e6-6e1293d21659';

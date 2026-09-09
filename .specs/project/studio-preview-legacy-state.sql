-- CI/preview fixtures only: simulate organizations that existed before templates.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.organizations WHERE
    (id = '11111111-1111-4111-8111-111111111111' AND slug = 'studio-qa-a') OR
    (id = '22222222-2222-4222-8222-222222222222' AND slug = 'studio-qa-b')) <> 2 THEN
    RAISE EXCEPTION 'Synthetic organizations missing';
  END IF;
END $$;
DELETE FROM public.metrics_studio_panels
 WHERE organization_id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
   AND template_key IS NOT NULL;
COMMIT;

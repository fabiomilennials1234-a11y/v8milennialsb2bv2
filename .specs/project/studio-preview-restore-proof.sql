-- PREVIEW ONLY. Prove the backup restores the synthetic legacy panel, then rollback.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = '11111111-1111-4111-8111-111111111111' AND slug = 'studio-qa-a') THEN
    RAISE EXCEPTION 'Synthetic preview organization missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM backup.metrics_studio_panels_20260908 WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1') THEN
    RAISE EXCEPTION 'Synthetic panel snapshot missing';
  END IF;
END $$;
DELETE FROM public.metrics_studio_panels
 WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND organization_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.metrics_studio_panels
SELECT * FROM backup.metrics_studio_panels_20260908
 WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND organization_id = '11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM backup.metrics_studio_panels_20260908 b JOIN public.metrics_studio_panels p USING (id)
    WHERE p.id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND to_jsonb(p) = to_jsonb(b)
  ) THEN RAISE EXCEPTION 'Restored panel differs from its snapshot'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: exact synthetic panel restoration from private backup' AS result;

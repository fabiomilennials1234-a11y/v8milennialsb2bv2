-- Append after migration 61 inside the caller's BEGIN / ROLLBACK envelope.
-- Synthetic storage metadata only: does not upload or delete any real file.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='workflow-question-images'
    AND public=false AND file_size_limit=5242880
    AND allowed_mime_types @> ARRAY['image/png','image/jpeg','image/webp']::text[]) THEN
    RAISE EXCEPTION 'FAIL private bucket metadata';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='workflow_question_images_api_only'
    AND permissive='RESTRICTIVE' AND cmd='ALL'
    AND roles @> ARRAY['anon','authenticated']::name[] AND array_length(roles,1)=2
    AND regexp_replace(qual,'[[:space:]()]','','g') = 'bucket_id<>''workflow-question-images''::text'
    AND regexp_replace(with_check,'[[:space:]()]','','g') = 'bucket_id<>''workflow-question-images''::text') THEN
    RAISE EXCEPTION 'FAIL private bucket API-only policy scope';
  END IF;
END $$;

INSERT INTO storage.objects (id,bucket_id,name,metadata) VALUES
 ('61000000-0000-4000-8000-000000000001','workflow-question-images','61000000-0000-4000-8000-000000000011/61000000-0000-4000-8000-000000000021.png','{"mimetype":"image/png","size":67}'),
 ('61000000-0000-4000-8000-000000000002','workflow-question-images','61000000-0000-4000-8000-000000000012/61000000-0000-4000-8000-000000000022.png','{"mimetype":"image/png","size":67}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000031","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='workflow-question-images') THEN
    RAISE EXCEPTION 'FAIL authenticated can read own/cross-org private image directly';
  END IF;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('workflow-question-images','61000000-0000-4000-8000-000000000011/61000000-0000-4000-8000-000000000023.png');
    RAISE EXCEPTION 'FAIL authenticated bypassed upload validation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE storage.objects SET metadata='{}' WHERE bucket_id='workflow-question-images';
  IF FOUND THEN RAISE EXCEPTION 'FAIL authenticated can overwrite retained image'; END IF;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id='workflow-question-images';
    IF FOUND THEN RAISE EXCEPTION 'FAIL authenticated can delete retained image'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    -- Hosted Storage additionally rejects SQL DELETE via protect_delete().
    -- Either that guard or zero rows through RLS must preserve both objects.
    NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='workflow-question-images') THEN
    RAISE EXCEPTION 'FAIL anonymous private image read';
  END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='workflow-question-images') <> 2 THEN
    RAISE EXCEPTION 'FAIL retained metadata changed';
  END IF;
END $$;
SELECT 'private_images_api_only_rollback_ok' AS result;

-- Apply the migration a SECOND time, then run this (includes updated_at).
DO $$ BEGIN
 IF EXISTS (
   (SELECT to_jsonb(p) FROM public.pipelines p EXCEPT SELECT row FROM public.navigation_after_first)
   UNION ALL
   (SELECT row FROM public.navigation_after_first EXCEPT SELECT to_jsonb(p) FROM public.pipelines p)
 ) THEN RAISE EXCEPTION 'Second migration application changed rows'; END IF;
END $$;
SELECT 'pipeline navigation regression checks passed' AS result;

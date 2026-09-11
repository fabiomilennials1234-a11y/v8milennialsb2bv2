-- Apply migration once more after 04-catalog-fixture.sql, then assert.
DO $$ BEGIN
 IF (SELECT config #> '{navigation,is_visible}' FROM public.pipelines WHERE name='Catalog fallback') IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Catalog true fallback not preserved'; END IF;
 IF EXISTS (SELECT 1 FROM public.pipelines p JOIN public.navigation_after_first b ON p.id::text=b.row->>'id' WHERE to_jsonb(p) IS DISTINCT FROM b.row)
 THEN RAISE EXCEPTION 'Already-imported decisions changed after catalog drift'; END IF;
END $$;

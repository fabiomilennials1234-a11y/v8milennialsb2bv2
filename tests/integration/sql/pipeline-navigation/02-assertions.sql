-- Run after applying 20271019000020_restore_pipeline_navigation.sql once.
DO $$
DECLARE actual jsonb;
BEGIN
 SELECT jsonb_object_agg(right(id::text,2), config #> '{navigation,is_visible}')
 INTO actual FROM public.pipelines;
 IF actual IS DISTINCT FROM '{"01":false,"02":true,"03":false,"04":false,"05":true,"06":true,"07":true,"08":null,"09":false,"10":true,"11":true,"12":true,"13":false,"14":true,"15":true,"16":false,"17":true,"18":true}'::jsonb THEN
   RAISE EXCEPTION 'Visibility/tenant/cutoff/expired-override mismatch: %', actual;
 END IF;
 IF EXISTS (
   (SELECT to_jsonb(p) - 'config' - 'updated_at' - 'display_order' FROM public.pipelines p
    EXCEPT SELECT row - 'config' - 'updated_at' - 'display_order' FROM public.navigation_before)
   UNION ALL
   (SELECT row - 'config' - 'updated_at' - 'display_order' FROM public.navigation_before
    EXCEPT SELECT to_jsonb(p) - 'config' - 'updated_at' - 'display_order' FROM public.pipelines p)
 ) THEN RAISE EXCEPTION 'Pipeline identity/business attributes changed'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.pipelines p JOIN public.navigation_before b ON p.id::text=b.row->>'id'
   WHERE COALESCE(p.config - 'navigation','{}'::jsonb)
         IS DISTINCT FROM COALESCE(NULLIF(b.row->'config', 'null'::jsonb) - 'navigation','{}'::jsonb)
 ) THEN RAISE EXCEPTION 'Unrelated config changed'; END IF;
 IF EXISTS (SELECT 1 FROM public.pipelines p JOIN public.navigation_before b ON p.id::text=b.row->>'id'
            WHERE p.created_at >= '2026-09-10 21:13:04+00' AND to_jsonb(p) IS DISTINCT FROM b.row)
 THEN RAISE EXCEPTION 'Post-cutoff entity changed'; END IF;
 IF (SELECT display_order FROM public.pipelines WHERE slug='explicit') <> 0
 OR (SELECT config #>> '{navigation,position}' FROM public.pipelines WHERE slug='explicit') <> '42'
 THEN RAISE EXCEPTION 'Explicit navigation overwritten'; END IF;
 IF (SELECT display_order FROM public.pipelines WHERE slug='temporary-newer') >=
    (SELECT display_order FROM public.pipelines WHERE slug='temporary-older')
 THEN RAISE EXCEPTION 'Temporary order reversed'; END IF;
 IF (SELECT display_order FROM public.pipelines WHERE slug='permanent') >=
    (SELECT display_order FROM public.pipelines WHERE slug='temporary-newer')
 THEN RAISE EXCEPTION 'Permanent/temporary order changed'; END IF;
 IF EXISTS (SELECT to_jsonb(d) FROM public.pipeline_display_config d EXCEPT SELECT row FROM public.display_before)
 OR EXISTS (SELECT to_jsonb(f) FROM public.organization_features f EXCEPT SELECT row FROM public.features_before)
 THEN RAISE EXCEPTION 'Legacy configuration or feature overrides changed'; END IF;
END $$;
CREATE TABLE public.navigation_after_first AS SELECT to_jsonb(p) AS row FROM public.pipelines p;

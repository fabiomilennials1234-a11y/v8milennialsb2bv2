DROP FUNCTION IF EXISTS public.oraculo_revenue_bottleneck(uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_person_profile_at(uuid,uuid,date);
ALTER FUNCTION public.oraculo_revenue_bottleneck_without_people(uuid,uuid)
  RENAME TO oraculo_revenue_bottleneck;

-- Rollback de 20271205000000_realtime_broadcast_s1_pipeline_entries.sql
--
-- Antes: desligue a flag das orgs piloto e espere ≤5 min (TTL do plano no
-- front) — senão quem está no broadcast fica sem eventos até recarregar:
--   UPDATE public.organizations SET feature_flags = feature_flags - 'realtime_broadcast_pe'
--    WHERE feature_flags ? 'realtime_broadcast_pe';
--
-- Sem ALTER TABLE realtime.messages (42501). DROP POLICY é delegado ao postgres
-- pelo supautils.policy_grants, como o CREATE.

DROP TRIGGER IF EXISTS zz_rt_broadcast_pipeline_entries_upd ON public.pipeline_entries;
DROP TRIGGER IF EXISTS zz_rt_broadcast_pipeline_entries_ins_del ON public.pipeline_entries;
DROP FUNCTION IF EXISTS private.rt_broadcast_pipeline_entries();
DROP FUNCTION IF EXISTS private.rt_pipeline_entry_row(public.pipeline_entries);
DROP FUNCTION IF EXISTS public.realtime_subscription_plan(uuid);
DROP POLICY IF EXISTS rt_broadcast_select ON realtime.messages;
DROP FUNCTION IF EXISTS private.realtime_can_join(text);

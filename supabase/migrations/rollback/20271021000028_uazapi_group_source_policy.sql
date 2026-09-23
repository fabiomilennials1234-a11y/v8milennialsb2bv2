-- First disable filter flag, reconcile EVERY managed instance and stop old writers.
-- Refuse to remove the safety barrier while any remote exclusion/uncertainty remains.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.uazapi_group_webhook_state WHERE excluded IS DISTINCT FROM false OR lease_token IS NOT NULL) THEN
  RAISE EXCEPTION 'remove_and_verify_all_remote_group_filters_before_rollback';
 END IF;
END $$;
DROP TRIGGER guard_uazapi_group_capture ON public.organizations;
DROP FUNCTION public.guard_uazapi_group_capture();
DROP FUNCTION public.recover_uazapi_group_webhook(uuid,uuid,uuid,boolean);
DROP FUNCTION public.finish_uazapi_group_webhook(uuid,uuid,uuid,bigint,boolean);
DROP FUNCTION public.prepare_uazapi_group_webhook(uuid,uuid,boolean);
DROP FUNCTION public.request_uazapi_group_capture(uuid,boolean);
DROP TABLE public.uazapi_group_webhook_state;
DROP TABLE public.uazapi_group_policy;

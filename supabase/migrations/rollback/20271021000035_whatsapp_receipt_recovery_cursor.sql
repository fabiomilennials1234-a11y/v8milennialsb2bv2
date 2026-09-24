-- Disable recovery only after the operator has stopped the runner and every
-- recovery lease has expired or finished. Keep state/results and trusted
-- ingress receipt_recovery provenance for already accepted work.
BEGIN;
LOCK TABLE public.whatsapp_receipt_recovery_state IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_receipt_recovery_state WHERE lease_until > now()) THEN
    RAISE EXCEPTION 'recovery rollback requires drained leases' USING ERRCODE = '55000';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.begin_whatsapp_receipt_recovery(uuid,uuid) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.enqueue_whatsapp_receipt_recovery(uuid,uuid,uuid,uuid,text,timestamptz) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.finish_whatsapp_receipt_recovery(uuid,uuid,uuid,jsonb,uuid[]) FROM service_role;
COMMIT;
